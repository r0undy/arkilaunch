import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDocumentIntelligenceAdapter } from '@arkilaunch/document-intelligence';
import { OCR_CORPUS_FLOOR, normalize } from '@arkilaunch/shared';
import type { DocumentExtractionResult, GoldSample } from '@arkilaunch/shared';

const MIN_EDTR_SAMPLES = OCR_CORPUS_FLOOR.edtr;
const MIN_KYC_SAMPLES = OCR_CORPUS_FLOOR.kyc;

const DOC_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf', '.tif', '.tiff'];

// RA 10173 PII: every KYC field plus these; never committed unhashed.
const PII_FIELD_TYPES = new Set(['sec_number', 'tin', 'company_name', 'address', 'operator_name']);

export type Kind = 'edtr' | 'kyc';

interface LabelFile {
  fields: Record<string, string | number>;
}

export interface Options {
  mode: 'training' | 'extract' | 'golden';
  staging: string;
  out: string;
  partial: boolean;
  model: string | undefined;
  kinds: Kind[];
}

export function parseArgs(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const mode = (get('mode') ?? 'training') as Options['mode'];
  if (!['training', 'extract', 'golden'].includes(mode)) {
    throw new Error(`unknown --mode=${mode} (expected training|extract|golden)`);
  }
  const kindsRaw = get('kind');
  const kinds = (kindsRaw ? kindsRaw.split(',') : ['edtr', 'kyc']) as Kind[];
  for (const k of kinds) {
    if (k !== 'edtr' && k !== 'kyc') throw new Error(`unknown --kind=${k} (expected edtr|kyc)`);
  }
  const staging = get('staging') ?? process.env.OCR_FIXTURES_DIR ?? '.ocr-fixtures';
  return {
    mode,
    staging: path.resolve(staging),
    out: path.resolve(get('out') ?? path.join(staging, 'training')),
    partial: argv.includes('--partial'),
    model: get('model'),
    kinds,
  };
}

export function redactValue(kind: Kind, fieldType: string, value: string | number): string | number {
  if (kind !== 'kyc' && !PII_FIELD_TYPES.has(fieldType)) return value;
  const digest = createHash('sha256').update(normalize(value)).digest('hex').slice(0, 12);
  return `redacted:${digest}`;
}

interface Sample {
  name: string;
  docFile: string;
  labels: LabelFile;
}

async function loadSamples(staging: string, kind: Kind): Promise<Sample[]> {
  const dir = path.join(staging, kind);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(`staging directory not found: ${dir}`);
  }

  const docs = entries.filter((f) => DOC_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  const samples: Sample[] = [];
  const missing: string[] = [];

  for (const docFile of docs) {
    const name = docFile.slice(0, -path.extname(docFile).length);
    const labelPath = path.join(dir, `${name}.labels.json`);
    let raw: string;
    try {
      raw = await readFile(labelPath, 'utf8');
    } catch {
      missing.push(docFile);
      continue;
    }
    const labels = JSON.parse(raw) as LabelFile;
    if (!labels.fields || typeof labels.fields !== 'object') {
      throw new Error(`${labelPath}: expected a top-level "fields" object of ground-truth values`);
    }
    samples.push({ name, docFile, labels });
  }

  if (missing.length > 0) {
    throw new Error(
      `${missing.length} ${kind} document(s) have no sibling .labels.json: ` +
        `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`,
    );
  }
  return samples;
}

async function runTraining(opts: Options) {
  for (const kind of opts.kinds) {
    const samples = await loadSamples(opts.staging, kind);
    const fieldKeys = [...new Set(samples.flatMap((s) => Object.keys(s.labels.fields)))].sort();

    const outDir = path.join(opts.out, kind);
    await mkdir(outDir, { recursive: true });

    await writeFile(
      path.join(outDir, 'fields.json'),
      `${JSON.stringify(
        {
          $schema: 'https://schema.cognitiveservices.azure.com/formrecognizer/2021-03-01/fields.json',
          fields: fieldKeys.map((fieldKey) => ({ fieldKey, fieldType: 'string', fieldFormat: 'not-specified' })),
        },
        null,
        2,
      )}\n`,
    );

    await writeFile(
      path.join(outDir, 'manifest.json'),
      `${JSON.stringify(
        {
          kind,
          generatedAt: new Date().toISOString(),
          documentCount: samples.length,
          fieldKeys,
          documents: samples.map((s) => ({
            name: s.name,
            file: s.docFile,
            fields: Object.keys(s.labels.fields).sort(),
          })),
          note:
            'Per-field boundingBoxes must be drawn in Document Intelligence Studio; ' +
            'they cannot be derived from ground-truth values alone.',
        },
        null,
        2,
      )}\n`,
    );

    console.log(`${kind}: ${samples.length} labeled document(s), ${fieldKeys.length} field(s) -> ${outDir}`);
    console.log(`${kind}: field keys: ${fieldKeys.join(', ')}`);
  }
}

async function runExtract(opts: Options) {
  if (!opts.model) throw new Error('--model=<modelId> is required for --mode=extract');
  const endpoint = process.env.AZURE_DI_ENDPOINT;
  const apiKey = process.env.AZURE_DI_KEY;
  if (!endpoint || !apiKey) {
    throw new Error('AZURE_DI_ENDPOINT and AZURE_DI_KEY are required for --mode=extract');
  }

  const adapter = createDocumentIntelligenceAdapter(process.env);

  for (const kind of opts.kinds) {
    const samples = await loadSamples(opts.staging, kind);
    const outDir = path.join(opts.staging, kind, 'extractions');
    await mkdir(outDir, { recursive: true });

    let ok = 0;
    for (const sample of samples) {
      const bytes = await readFile(path.join(opts.staging, kind, sample.docFile));
      try {
        const result = await adapter.analyze(opts.model, bytes);
        await writeFile(path.join(outDir, `${sample.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
        ok += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeFile(
          path.join(outDir, `${sample.name}.error.json`),
          `${JSON.stringify({ error: message }, null, 2)}\n`,
        );
        console.error(`${kind}/${sample.name}: extraction failed: ${message}`);
      }
    }
    console.log(`${kind}: extracted ${ok}/${samples.length} document(s) with model ${opts.model} -> ${outDir}`);
  }
}

async function runGolden(opts: Options) {
  const built: Record<Kind, GoldSample[]> = { edtr: [], kyc: [] };
  const skipped: Record<Kind, number> = { edtr: 0, kyc: 0 };

  for (const kind of opts.kinds) {
    const samples = await loadSamples(opts.staging, kind);
    const extractionsDir = path.join(opts.staging, kind, 'extractions');

    for (const sample of samples) {
      let result: DocumentExtractionResult;
      try {
        const raw = await readFile(path.join(extractionsDir, `${sample.name}.json`), 'utf8');
        result = JSON.parse(raw) as DocumentExtractionResult;
      } catch {
        skipped[kind] += 1;
        continue;
      }

      for (const [fieldType, groundTruth] of Object.entries(sample.labels.fields)) {
        const extracted = result.fields[fieldType];
        if (!extracted) {
          // Scored as wrong at confidence 0, not skipped, or accuracy is flattered.
          built[kind].push({
            fieldType,
            extractedValue: redactValue(kind, fieldType, ''),
            groundTruth: redactValue(kind, fieldType, groundTruth),
            confidence: 0,
          });
          continue;
        }
        const asNumber = Number(extracted.value);
        const isNumeric =
          typeof groundTruth === 'number' && Number.isFinite(asNumber) && extracted.value.trim() !== '';
        built[kind].push({
          fieldType,
          extractedValue: redactValue(kind, fieldType, isNumeric ? asNumber : extracted.value),
          groundTruth: redactValue(kind, fieldType, groundTruth),
          confidence: extracted.confidence,
        });
      }
    }
  }

  const floors: Array<[Kind, number, number]> = [
    ['edtr', built.edtr.length, MIN_EDTR_SAMPLES],
    ['kyc', built.kyc.length, MIN_KYC_SAMPLES],
  ];
  const short = floors.filter(([kind, have, floor]) => opts.kinds.includes(kind) && have < floor);
  if (short.length > 0 && !opts.partial) {
    throw new Error(
      `corpus below the QAD §2 floor: ${short
        .map(([kind, have, floor]) => `${kind} has ${have} sample(s), needs ${floor}`)
        .join('; ')}. Re-run with --partial to write it anyway ` +
        `(the sample count is stamped into the file).`,
    );
  }

  const target = path.resolve(fileURLToPath(import.meta.url), '../../../packages/db/src/seed/ocr-fixtures/golden-set.ts');
  await writeFile(target, renderGoldenSet(built, { partial: opts.partial, skipped }));

  console.log(`wrote ${target}`);
  console.log(
    `  edtr: ${built.edtr.length} sample(s)${skipped.edtr ? ` (${skipped.edtr} document(s) had no extraction)` : ''}`,
  );
  console.log(
    `  kyc:  ${built.kyc.length} sample(s)${skipped.kyc ? ` (${skipped.kyc} document(s) had no extraction)` : ''}`,
  );
  if (short.length > 0) {
    console.warn('WARNING: written under --partial; this corpus is below the QAD §2 floor and does not measure QAD-T39.');
  }
}

export function renderGoldenSet(
  built: Record<Kind, GoldSample[]>,
  meta: { partial: boolean; skipped: Record<Kind, number> },
): string {
  const render = (samples: GoldSample[]) =>
    samples
      .map(
        (s) =>
          `  { fieldType: ${JSON.stringify(s.fieldType)}, extractedValue: ${JSON.stringify(s.extractedValue)}, ` +
          `groundTruth: ${JSON.stringify(s.groundTruth)}, confidence: ${s.confidence} },`,
      )
      .join('\n');

  const edtrNote = meta.skipped.edtr ? `, ${meta.skipped.edtr} document(s) excluded for having no extraction` : '';
  const kycNote = meta.skipped.kyc ? `, ${meta.skipped.kyc} document(s) excluded for having no extraction` : '';

  return `import type { GoldSample } from '@arkilaunch/shared';

// GENERATED by \`pnpm ocr:fixtures:pull --mode=golden\`. Do not hand-edit --
// re-run the script against the staging corpus instead.
//
// Generated: ${new Date().toISOString()}
// EDTR samples: ${built.edtr.length} (QAD §2 floor: ${MIN_EDTR_SAMPLES})${edtrNote}
// KYC samples:  ${built.kyc.length} (QAD §2 floor: ${MIN_KYC_SAMPLES})${kycNote}
// Corpus status: ${meta.partial ? 'PARTIAL -- below the QAD §2 floor, does NOT measure QAD-T39' : 'meets the QAD §2 floor'}
//
// PII note (RA 10173): values for SEC/TIN-class fields are surrogates derived
// from a hash of the normalized value, on BOTH sides of the comparison, so
// exact-match accuracy is identical to the unredacted corpus while no real
// SEC or TIN number is committed. Hour readings are verbatim.
export const EDTR_GOLDEN_SET: GoldSample[] = [
${render(built.edtr)}
];

export const KYC_GOLDEN_SET: GoldSample[] = [
${render(built.kyc)}
];
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'training') await runTraining(opts);
  else if (opts.mode === 'extract') await runExtract(opts);
  else await runGolden(opts);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
