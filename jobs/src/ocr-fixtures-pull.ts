// `pnpm ocr:fixtures:pull` -- the fixture ingestion QAD §2 already assumes
// exists ("labeled golden set of scanned EDTR + KYC field images with
// ground-truth values"). Lives in jobs/ rather than packages/db because this
// package already depends on db, document-intelligence and shared; putting it
// in db would add a db -> document-intelligence edge for a dev-only script.
//
// Three modes, because a golden sample cannot be built from ground truth
// alone -- it needs what the model actually returned:
//
//   training  read <staging>/{edtr,kyc}/*.{jpg,png,pdf} + <name>.labels.json,
//             emit the Azure DI field schema + a manifest for DI Studio.
//   extract   run a trained model over those documents, writing the raw
//             extraction results to <staging>/<kind>/extractions/<name>.json.
//   golden    pair ground truth with extraction results and regenerate
//             packages/db/src/seed/ocr-fixtures/golden-set.ts.
//
// What this deliberately does NOT do: synthesize Azure's per-field
// `boundingBoxes`. Those come from drawing on the page in DI Studio and
// cannot be derived from a value alone. Emitting a labels file with
// fabricated regions would produce a model trained on nonsense, so `training`
// emits the field schema and stops there.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AzureDocumentIntelligenceAdapter } from '@arkilaunch/document-intelligence';
import type { DocumentExtractionResult, GoldSample } from '@arkilaunch/shared';

// QAD §2's corpus floor. A golden set below this measures nothing
// trustworthy, so writing one requires an explicit --partial.
const MIN_EDTR_SAMPLES = 200;
const MIN_KYC_SAMPLES = 50;

const DOC_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf', '.tif', '.tiff'];

// Field types whose values are personal information under RA 10173 and must
// never land in a committed fixture. Both sides of the comparison are
// replaced by a surrogate derived from the NORMALIZED value, so exact-match
// equality -- the only thing computeAccuracy() asks of these -- is preserved
// bit for bit while the real number never leaves the operator's machine.
// EDTR hour readings carry no PII and stay verbatim.
const PII_FIELD_TYPES = new Set(['sec_number', 'tin', 'company_name', 'address', 'operator_name']);

export type Kind = 'edtr' | 'kyc';

interface LabelFile {
  // Ground truth only. Keyed by the same snake_case field names the port
  // contract promises (packages/shared/src/document-intelligence-port.ts).
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

// Mirrors normalize() in packages/shared/src/ocr-accuracy.ts exactly. If that
// ever changes, this must change with it or redacted samples stop comparing
// the way their unredacted originals would.
function normalizeForCompare(value: string | number): string {
  if (typeof value === 'number') return value.toFixed(2);
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function redactValue(fieldType: string, value: string | number): string | number {
  if (!PII_FIELD_TYPES.has(fieldType)) return value;
  const digest = createHash('sha256').update(normalizeForCompare(value)).digest('hex').slice(0, 12);
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
    // An unlabeled document is not a zero-field document. Refuse the whole
    // run rather than quietly training on a smaller corpus than the operator
    // believes they supplied.
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

    // Azure DI custom-model field schema. Every field is declared `string`:
    // the adapter's extractValue() already accepts valueNumber/valueString/
    // valueDate and the worker does its own numeric parse, so a narrower
    // declared type here would only add a second place for the two to
    // disagree.
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

  const adapter = new AzureDocumentIntelligenceAdapter({
    endpoint,
    apiKey,
    ...(process.env.AZURE_DI_MAX_PAGES ? { maxPagesPerDocument: Number(process.env.AZURE_DI_MAX_PAGES) } : {}),
  });

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
        // Recorded as a failure, never as an empty extraction -- a document
        // the model could not read must not become a sample that scores as
        // a wrong answer, and must not silently vanish either.
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
        // No extraction for this document (never run, or it hard-failed).
        // Excluded from the accuracy corpus and counted, because a document
        // the model refused is a different measurement from a field it got
        // wrong, and folding the two together would flatter the model.
        skipped[kind] += 1;
        continue;
      }

      for (const [fieldType, groundTruth] of Object.entries(sample.labels.fields)) {
        const extracted = result.fields[fieldType];
        if (!extracted) {
          // The model returned nothing for a field we have ground truth for.
          // That IS a wrong answer at confidence 0 -- it is scored, not
          // skipped, or the corpus would measure only what the model chose
          // to answer.
          built[kind].push({
            fieldType,
            extractedValue: redactValue(fieldType, ''),
            groundTruth: redactValue(fieldType, groundTruth),
            confidence: 0,
          });
          continue;
        }
        const asNumber = Number(extracted.value);
        const isNumeric =
          typeof groundTruth === 'number' && Number.isFinite(asNumber) && extracted.value.trim() !== '';
        built[kind].push({
          fieldType,
          extractedValue: redactValue(fieldType, isNumeric ? asNumber : extracted.value),
          groundTruth: redactValue(fieldType, groundTruth),
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

  const target = path.resolve('packages/db/src/seed/ocr-fixtures/golden-set.ts');
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

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
