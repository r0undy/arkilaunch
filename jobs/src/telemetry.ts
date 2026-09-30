import { pathToFileURL } from 'node:url';
import { useAzureMonitor, shutdownAzureMonitor } from '@azure/monitor-opentelemetry';

let initialized = false;

function init(jobName: string): void {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString || initialized) return;
  try {
    useAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
      instrumentationOptions: {
        http: { enabled: false },
        postgreSql: { enabled: false },
        mongoDb: { enabled: false },
        mySql: { enabled: false },
        redis: { enabled: false },
        redis4: { enabled: false },
        azureSdk: { enabled: false },
        console: { enabled: false },
        winston: { enabled: false },
        bunyan: { enabled: false },
      },
      enablePerformanceCounters: false,
    });
    initialized = true;
    console.log(`telemetry: Azure Monitor enabled for job "${jobName}".`);
  } catch (err) {
    console.error(`telemetry: failed to initialize for job "${jobName}"; continuing uninstrumented.`, err);
  }
}

// The flush in `finally` is the point: an ACA Job exits on return and would
// drop the exporter's buffered spans.
export async function runInstrumentedJob(jobName: string, fn: () => Promise<void>): Promise<void> {
  init(jobName);
  try {
    await fn();
  } finally {
    if (initialized) {
      await shutdownAzureMonitor().catch(() => {});
    }
  }
}

// pathToFileURL, not `file://${argv[1]}`: on Windows the latter never matches import.meta.url.
export function runJobIfMain(importMetaUrl: string, jobName: string, fn: () => Promise<unknown>): void {
  if (!process.argv[1] || pathToFileURL(process.argv[1]).href !== importMetaUrl) return;
  runInstrumentedJob(jobName, async () => {
    await fn();
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
