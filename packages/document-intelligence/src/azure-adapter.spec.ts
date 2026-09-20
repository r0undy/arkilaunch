import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ExtractionUnavailableError } from '@arkilaunch/shared';
import { AzureDocumentIntelligenceAdapter, DocumentAnalysisError } from './azure-adapter.js';
import { EDTR_MODEL_ID, resolveModelRequest } from './model-registry.js';

const ENDPOINT = 'https://di-arkilaunch-dev.cognitiveservices.azure.com';
const OPERATION_LOCATION = `${ENDPOINT}/documentintelligence/documentModels/prebuilt-layout/analyzeResults/abc123`;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('AzureDocumentIntelligenceAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an empty input buffer rather than calling Azure', async () => {
    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    await expect(adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.alloc(0))).rejects.toBeInstanceOf(
      DocumentAnalysisError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a missing confidence to 0, never to 1', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [{}],
            documents: [{ fields: { hours_active: { valueNumber: 8 } } }],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.from('x'));
    expect(result.fields.hours_active).toEqual({ value: '8', confidence: 0 });
  });

  it('floors an out-of-range confidence to 0, never clamps to 1', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [{}],
            documents: [{ fields: { operator: { valueString: 'R. Cruz', confidence: 1.5 } } }],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.from('x'));
    expect(result.fields.operator?.confidence).toBe(0);
  });

  it('maps 401 to ExtractionUnavailableError(no_credentials)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(401, { error: { code: 'Unauthorized' } }));
    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'bad' });
    await expect(adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.from('x'))).rejects.toMatchObject({
      reason: 'no_credentials',
    });
    await expect(
      adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.from('x')),
    ).rejects.toBeInstanceOf(ExtractionUnavailableError);
  });

  it('hard-fails a 404 (unknown model) rather than returning an empty result', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(404, { error: { code: 'ModelNotFound' } }));
    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    await expect(adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.from('x'))).rejects.toBeInstanceOf(
      DocumentAnalysisError,
    );
  });

  it('hard-fails rather than returning a result when the tier truncates the document', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: { pages: [{}, {}], documents: [{ fields: {} }] },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k', maxPagesPerDocument: 2 });
    await expect(adapter.analyze('prebuilt-layout', Buffer.from('x'))).rejects.toBeInstanceOf(DocumentAnalysisError);
  });

  it('maps KYC queryFields camelCase names back to the port contract keys', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [{}],
            documents: [
              {
                fields: {
                  SecNumber: { valueString: 'CS202312345', confidence: 0.95 },
                  Tin: { valueString: '123-456-789-000', confidence: 0.92 },
                },
              },
            ],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze('arkilaunch-kyc-layout-query', Buffer.from('x'));
    expect(result.fields.sec_number).toEqual({ value: 'CS202312345', confidence: 0.95 });
    expect(result.fields.tin).toEqual({ value: '123-456-789-000', confidence: 0.92 });
  });

  // Pins the REQUEST, not just the response. The mapping above was written
  // against a hand-made payload; this shape was verified on 2026-09-16
  // against the live di-arkilaunch-dev resource, which accepted exactly this
  // URL and body (202 -> succeeded, SecNumber at 0.995). Azure rejects
  // queryFields unless `features=queryFields` accompanies it, and a custom
  // model id must NOT carry either, so both halves are asserted here.
  it('sends the queryFields request shape Azure actually accepts, and a bare model id without it', async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const succeeded = () =>
      jsonResponse(200, {
        status: 'succeeded',
        analyzeResult: { pages: [{}], documents: [{ fields: {} }] },
      });

    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(succeeded());

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    await adapter.analyze('arkilaunch-kyc-layout-query', Buffer.from('hello'));

    const [kycUrl, kycInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The logical id resolves to the prebuilt model; the custom id is never sent.
    expect(kycUrl).toContain('/documentModels/prebuilt-layout:analyze');
    expect(kycUrl).not.toContain('arkilaunch-kyc-layout-query');
    expect(kycUrl).toContain('api-version=2024-11-30');
    expect(kycUrl).toContain('features=queryFields');
    expect(decodeURIComponent(kycUrl)).toContain('queryFields=SecNumber,Tin');
    // Bytes travel base64-in-JSON, not as a raw binary body.
    expect(kycInit.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(kycInit.body))).toEqual({ base64Source: Buffer.from('hello').toString('base64') });

    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(succeeded());

    await adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.from('hello'));
    const [edtrUrl] = fetchMock.mock.calls[0] as [string];
    expect(edtrUrl).toContain('/documentModels/arkilaunch-edtr-neural-v1:analyze');
    expect(edtrUrl).not.toContain('queryFields');
  });

  it('never returns a fabricated result when the operation fails', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { status: 'failed', error: { code: 'InvalidContent' } }));

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    await expect(adapter.analyze('arkilaunch-edtr-neural-v1', Buffer.from('x'))).rejects.toBeInstanceOf(
      DocumentAnalysisError,
    );
  });
  // The EDTR path reads the timesheet GRID, not document-level fields. This
  // is the shape the live di-arkilaunch-dev resource returned for a replica
  // of the real Almara form (docs/cr-arkilaunch-edtr-real-form.md).
  it('maps the layout table through, with per-cell confidence from word spans', async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [
              {
                words: [
                  { content: '03/01', confidence: 0.93, span: { offset: 0, length: 5 } },
                  { content: '10.5', confidence: 0.81, span: { offset: 6, length: 4 } },
                ],
              },
            ],
            tables: [
              {
                rowCount: 1,
                columnCount: 2,
                cells: [
                  { rowIndex: 0, columnIndex: 0, content: '03/01', spans: [{ offset: 0, length: 5 }] },
                  { rowIndex: 0, columnIndex: 1, content: '10.5', spans: [{ offset: 6, length: 4 }] },
                ],
              },
            ],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze(EDTR_MODEL_ID, Buffer.from('x'));

    expect(result.tables).toHaveLength(1);
    expect(result.tables![0]!.cells).toEqual([
      { rowIndex: 0, columnIndex: 0, content: '03/01', confidence: 0.93 },
      { rowIndex: 0, columnIndex: 1, content: '10.5', confidence: 0.81 },
    ]);
  });

  it('floors a cell to zero confidence when its words cannot be located', async () => {
    // Below the 0.90 gate, so the day routes to a human. Defaulting to 1
    // would sail a cell nobody measured straight through.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [{ words: [{ content: 'elsewhere', confidence: 0.99, span: { offset: 900, length: 9 } }] }],
            tables: [
              {
                rowCount: 1,
                columnCount: 1,
                cells: [{ rowIndex: 0, columnIndex: 0, content: '8.5', spans: [{ offset: 0, length: 3 }] }],
              },
            ],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze(EDTR_MODEL_ID, Buffer.from('x'));
    expect(result.tables![0]!.cells[0]!.confidence).toBe(0);
  });

  it('expands a merged header cell across every column it covers', async () => {
    // The real Almara header merges "AM" across its IN/OUT pair. Dropping
    // such a cell deleted the header outright and the whole sheet parsed as
    // no timesheet at all -- which is how this was caught, against the live
    // resource. Azure reports explicit indices, so expanding cannot shift a
    // neighbouring column.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [{ words: [{ content: 'AM', confidence: 0.99, span: { offset: 0, length: 2 } }] }],
            tables: [
              {
                rowCount: 1,
                columnCount: 2,
                cells: [
                  { rowIndex: 0, columnIndex: 0, content: 'AM', columnSpan: 2, spans: [{ offset: 0, length: 2 }] },
                ],
              },
            ],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze(EDTR_MODEL_ID, Buffer.from('x'));
    expect(result.tables![0]!.cells).toEqual([
      { rowIndex: 0, columnIndex: 0, content: 'AM', confidence: 0.99 },
      { rowIndex: 0, columnIndex: 1, content: 'AM', confidence: 0.99 },
    ]);
  });

  it('normalises a cell polygon against its page, so inches and pixels draw alike', async () => {
    // Azure reports polygons in the page's own unit -- inches for a PDF,
    // pixels for an image. A review overlay drawing raw coordinates would
    // be right for one and badly wrong for the other, and would point at a
    // cell the model never read. Scaled to 0..1 here, once.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [
              {
                pageNumber: 1,
                width: 8.5,
                height: 11,
                words: [{ content: '10.5', confidence: 0.93, span: { offset: 0, length: 4 } }],
              },
            ],
            tables: [
              {
                rowCount: 1,
                columnCount: 1,
                cells: [
                  {
                    rowIndex: 0,
                    columnIndex: 0,
                    content: '10.5',
                    spans: [{ offset: 0, length: 4 }],
                    boundingRegions: [
                      { pageNumber: 1, polygon: [4.25, 5.5, 8.5, 5.5, 8.5, 11, 4.25, 11] },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze(EDTR_MODEL_ID, Buffer.from('x'));
    expect(result.tables![0]!.cells[0]!.boundingRegion).toEqual({
      page: 1,
      polygon: [0.5, 0.5, 1, 0.5, 1, 1, 0.5, 1],
    });
  });

  it('omits the bounding region when the page reports no size to scale against', async () => {
    // No box at all beats a box in the wrong place: a misplaced highlight
    // tells a reviewer the model read a cell it did not.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, { status: 202, headers: { 'Operation-Location': OPERATION_LOCATION } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status: 'succeeded',
          analyzeResult: {
            pages: [{ pageNumber: 1, words: [] }],
            tables: [
              {
                rowCount: 1,
                columnCount: 1,
                cells: [
                  {
                    rowIndex: 0,
                    columnIndex: 0,
                    content: '10.5',
                    spans: [{ offset: 0, length: 4 }],
                    boundingRegions: [{ pageNumber: 1, polygon: [1, 1, 2, 1, 2, 2, 1, 2] }],
                  },
                ],
              },
            ],
          },
        }),
      );

    const adapter = new AzureDocumentIntelligenceAdapter({ endpoint: ENDPOINT, apiKey: 'k' });
    const result = await adapter.analyze(EDTR_MODEL_ID, Buffer.from('x'));
    expect(result.tables![0]!.cells[0]!.boundingRegion).toBeUndefined();
  });

  it('sends the EDTR model to prebuilt-layout without queryFields', async () => {
    // queryFields answers per-document scalars; this sheet's payload is a
    // table of dated rows. Asked for the same sheet's Operator against the
    // live resource, queryFields returned the letterhead at 0.883.
    expect(resolveModelRequest(EDTR_MODEL_ID)).toEqual({ kind: 'model', modelId: 'prebuilt-layout' });
  });
});
