import {
  ExtractionUnavailableError,
  type DocumentExtractionResult,
  type DocumentIntelligencePort,
  type BoundingRegion,
  type DocumentText,
  type ExtractedField,
  type ExtractedTable,
} from '@arkilaunch/shared';
import { QUERY_FIELD_TO_PORT_KEY, resolveModelRequest, type ModelRequest } from './model-registry.js';

const API_VERSION = '2024-11-30';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;
// Per-request socket timeout: POLL_TIMEOUT_MS is only checked after a response, so a hung socket never fails.
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new DocumentAnalysisError(
        `Azure DI request timed out after ${REQUEST_TIMEOUT_MS}ms with no response`,
      );
    }
    throw err;
  }
}

// F0 throttles hard; a 429 means retry after Retry-After (default 2s), within the deadline.
async function fetchThrottled(url: string, init: RequestInit, deadline: number): Promise<Response> {
  for (;;) {
    const res = await fetchWithTimeout(url, init);
    if (res.status !== 429 || Date.now() >= deadline) return res;
    const wait = Number(res.headers.get('Retry-After')) * 1000 || POLL_INTERVAL_MS;
    await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
  }
}

// "Answered but untrustworthy", distinct from ExtractionUnavailableError; never fabricate a value.
export class DocumentAnalysisError extends Error {}

interface AzureAnalyzeField {
  valueString?: string;
  valueNumber?: number;
  valueInteger?: number;
  valueDate?: string;
  valueTime?: string;
  valueBoolean?: boolean;
  valueSelectionMark?: string;
  content?: string;
  confidence?: number;
}

interface AzureSpan {
  offset?: number;
  length?: number;
}

interface AzureAnalyzeTable {
  rowCount?: number;
  columnCount?: number;
  cells?: Array<{
    rowIndex?: number;
    columnIndex?: number;
    rowSpan?: number;
    columnSpan?: number;
    content?: string;
    spans?: AzureSpan[];
    boundingRegions?: AzureBoundingRegion[];
  }>;
}

interface AzureBoundingRegion {
  pageNumber?: number;
  polygon?: number[];
}

// Polygons are in the page's own unit, so width and height are needed to normalise them.
interface AzurePage {
  pageNumber?: number;
  width?: number;
  height?: number;
  words?: AzureWord[];
  lines?: AzureLine[];
}

interface AzureWord {
  confidence?: number;
  span?: AzureSpan;
}

interface AzureLine {
  polygon?: number[];
  spans?: AzureSpan[];
}

interface AzureAnalyzeOperation {
  status: 'notStarted' | 'running' | 'succeeded' | 'failed';
  error?: { code?: string; message?: string };
  analyzeResult?: {
    content?: string;
    pages?: AzurePage[];
    documents?: Array<{ fields?: Record<string, AzureAnalyzeField> }>;
    tables?: AzureAnalyzeTable[];
  };
}

export interface AzureDocumentIntelligenceAdapterOptions {
  endpoint: string;
  apiKey: string;
  // F0 reads only the first 2 pages and silently returns a truncated result: set 2 for F0, unset for S0.
  maxPagesPerDocument?: number;
}

export class AzureDocumentIntelligenceAdapter implements DocumentIntelligencePort {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxPagesPerDocument: number | undefined;

  constructor(options: AzureDocumentIntelligenceAdapterOptions) {
    this.baseUrl = options.endpoint.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.maxPagesPerDocument = options.maxPagesPerDocument;
  }

  async analyze(modelId: string, imageStream: Buffer): Promise<DocumentExtractionResult> {
    if (imageStream.length === 0) {
      // Fail loudly: an empty base64Source comes back reading as a genuinely blank sheet.
      throw new DocumentAnalysisError('empty input buffer');
    }

    const request = resolveModelRequest(modelId);
    const operationLocation = await this.startAnalyze(request, imageStream);
    const body = await this.pollUntilDone(operationLocation);

    if (body.status !== 'succeeded' || !body.analyzeResult) {
      throw new DocumentAnalysisError(
        `Azure DI analysis ended in status "${body.status}"${body.error?.code ? ` (${body.error.code})` : ''}`,
      );
    }

    const { analyzeResult } = body;

    if (
      this.maxPagesPerDocument !== undefined &&
      (analyzeResult.pages?.length ?? 0) >= this.maxPagesPerDocument
    ) {
      // Hard-fail: a truncated extraction looks identical to a genuine short document.
      throw new DocumentAnalysisError(
        `document has >= ${this.maxPagesPerDocument} pages; this Document Intelligence tier only reads the first ${this.maxPagesPerDocument}`,
      );
    }

    const tables = mapTables(analyzeResult.tables, analyzeResult.pages);
    const text = mapText(analyzeResult.content, analyzeResult.pages);
    return {
      fields: this.mapFields(request, analyzeResult),
      ...(tables.length > 0 ? { tables } : {}),
      ...(text ? { text } : {}),
    };
  }

  private async startAnalyze(request: ModelRequest, imageStream: Buffer): Promise<string> {
    const query = new URLSearchParams({ 'api-version': API_VERSION });
    if (request.kind === 'query-fields') {
      query.set('features', 'queryFields');
      query.set('queryFields', request.queryFields.join(','));
    }

    const res = await fetchThrottled(
      `${this.baseUrl}/documentintelligence/documentModels/${request.modelId}:analyze?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base64Source: imageStream.toString('base64') }),
      },
      Date.now() + POLL_TIMEOUT_MS,
    );

    if (res.status === 401 || res.status === 403) {
      throw new ExtractionUnavailableError('no_credentials');
    }
    if (res.status === 404) {
      // Model not trained/deployed yet: surface it, never a silent empty result.
      throw new DocumentAnalysisError(`model not found: ${request.modelId}`);
    }
    if (res.status !== 202) {
      const text = await res.text().catch(() => '');
      throw new DocumentAnalysisError(`Azure DI request failed (${res.status}): ${text.slice(0, 200)}`);
    }

    const operationLocation = res.headers.get('Operation-Location');
    if (!operationLocation) {
      throw new DocumentAnalysisError('Azure DI accepted the request but returned no Operation-Location');
    }
    return operationLocation;
  }

  private async pollUntilDone(operationLocation: string): Promise<AzureAnalyzeOperation> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    for (;;) {
      const res = await fetchThrottled(
        operationLocation,
        { headers: { 'Ocp-Apim-Subscription-Key': this.apiKey } },
        deadline,
      );
      if (!res.ok) {
        throw new DocumentAnalysisError(`Azure DI poll failed (${res.status})`);
      }
      const body = (await res.json()) as AzureAnalyzeOperation;
      if (body.status === 'succeeded' || body.status === 'failed') {
        return body;
      }
      if (Date.now() >= deadline) {
        throw new DocumentAnalysisError('document analysis timed out');
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  private mapFields(
    request: ModelRequest,
    analyzeResult: NonNullable<AzureAnalyzeOperation['analyzeResult']>,
  ): Record<string, ExtractedField> {
    const document = analyzeResult.documents?.[0];
    const rawFields = document?.fields ?? {};
    const fields: Record<string, ExtractedField> = {};

    for (const [rawKey, field] of Object.entries(rawFields)) {
      const key = request.kind === 'query-fields' ? (QUERY_FIELD_TO_PORT_KEY[rawKey] ?? rawKey) : rawKey;
      const value = extractValue(field);
      if (value === null) continue;

      fields[key] = { value, confidence: unitConfidence(field.confidence) };
    }

    return fields;
  }
}

// A missing or out-of-range confidence floors to 0 (human review), never 1 (would pass the auto-accept gate).
function unitConfidence(c: number | undefined): number {
  return typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1 ? c : 0;
}

// Scaled into 0..1 of the page; undefined when malformed, since a box in the wrong place is worse than none.
function scalePolygon(polygon: number[] | undefined, width: number, height: number): number[] | undefined {
  if (!polygon || polygon.length < 8 || polygon.length % 2 !== 0) return undefined;
  const scaled = polygon.map((v, i) => (i % 2 === 0 ? v / width : v / height));
  return scaled.some((n) => !Number.isFinite(n)) ? undefined : scaled;
}

// The lowest confidence of the words overlapping a cell's spans.
function cellConfidence(spans: AzureSpan[] | undefined, words: AzureWord[]): number {
  const ranges = (spans ?? [])
    .filter((s) => typeof s.offset === 'number' && typeof s.length === 'number')
    .map((s) => [s.offset!, s.offset! + s.length!] as const);
  if (ranges.length === 0) return 0;

  let min = Number.POSITIVE_INFINITY;
  for (const word of words) {
    const offset = word.span?.offset;
    const length = word.span?.length;
    if (typeof offset !== 'number' || typeof length !== 'number') continue;
    if (!ranges.some(([start, end]) => offset < end && offset + length > start)) continue;
    min = Math.min(min, unitConfidence(word.confidence));
  }
  return Number.isFinite(min) ? min : 0;
}

function normaliseRegion(
  regions: AzureBoundingRegion[] | undefined,
  pagesByNumber: Map<number, AzurePage>,
): BoundingRegion | undefined {
  const region = regions?.[0];
  if (!region) return undefined;
  const pageNumber = region.pageNumber ?? 1;
  const page = pagesByNumber.get(pageNumber);
  if (!page?.width || !page.height) return undefined;
  const scaled = scalePolygon(region.polygon, page.width, page.height);
  return scaled ? { page: pageNumber, polygon: scaled } : undefined;
}

function mapTables(
  tables: AzureAnalyzeTable[] | undefined,
  pages: AzurePage[] | undefined,
): ExtractedTable[] {
  const words = (pages ?? []).flatMap((p) => p.words ?? []);
  const pagesByNumber = new Map(
    (pages ?? []).map((page, index) => [page.pageNumber ?? index + 1, page] as const),
  );
  return (tables ?? [])
    .filter((t) => typeof t.rowCount === 'number' && typeof t.columnCount === 'number')
    .map((t) => ({
      rowCount: t.rowCount!,
      columnCount: t.columnCount!,
      cells: (t.cells ?? [])
        .filter((c) => typeof c.rowIndex === 'number' && typeof c.columnIndex === 'number')
        .flatMap((c) => {
          const content = (c.content ?? '').replace(/\s+/g, ' ').trim();
          const confidence = cellConfidence(c.spans, words);
          const boundingRegion = normaliseRegion(c.boundingRegions, pagesByNumber);
          const out: ExtractedTable['cells'] = [];
          for (let dr = 0; dr < Math.max(1, c.rowSpan ?? 1); dr++) {
            for (let dc = 0; dc < Math.max(1, c.columnSpan ?? 1); dc++) {
              out.push({
                rowIndex: c.rowIndex! + dr,
                columnIndex: c.columnIndex! + dc,
                content,
                confidence,
                ...(boundingRegion ? { boundingRegion } : {}),
              });
            }
          }
          return out;
        }),
    }));
}

// The page text with every word and line as a span of it; a line without a usable polygon, span or page size is left out.
function mapText(content: string | undefined, pages: AzurePage[] | undefined): DocumentText | undefined {
  if (!content) return undefined;
  const words: DocumentText['words'] = [];
  const lines: DocumentText['lines'] = [];
  (pages ?? []).forEach((page, index) => {
    for (const w of page.words ?? []) {
      const { offset, length } = w.span ?? {};
      if (typeof offset !== 'number' || typeof length !== 'number') continue;
      words.push({ offset, length, confidence: unitConfidence(w.confidence) });
    }
    const { width, height } = page;
    if (!width || !height) return;
    for (const line of page.lines ?? []) {
      const { offset, length } = line.spans?.[0] ?? {};
      if (typeof offset !== 'number' || typeof length !== 'number') continue;
      const scaled = scalePolygon(line.polygon, width, height);
      if (!scaled) continue;
      lines.push({ offset, length, page: page.pageNumber ?? index + 1, polygon: scaled });
    }
  });
  return { content, words, lines };
}

function extractValue(field: AzureAnalyzeField): string | null {
  if (typeof field.valueString === 'string') return field.valueString;
  if (typeof field.valueNumber === 'number') return String(field.valueNumber);
  if (typeof field.valueInteger === 'number') return String(field.valueInteger);
  if (typeof field.valueDate === 'string') return field.valueDate;
  if (typeof field.valueTime === 'string') return field.valueTime;
  if (typeof field.valueBoolean === 'boolean') return String(field.valueBoolean);
  if (typeof field.valueSelectionMark === 'string') return field.valueSelectionMark;
  if (typeof field.content === 'string') return field.content;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
