import { useAzureMonitor, shutdownAzureMonitor } from '@azure/monitor-opentelemetry';

let initialized = false;

// Graceful no-op: same guard as apps/api/src/telemetry/instrumentation.ts --
// APPLICATIONINSIGHTS_CONNECTION_STRING is absent in local dev/CI and
// filtered out of the Container App secrets when blank.
function init(jobName: string): void {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString || initialized) return;
  try {
    useAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
      // Nothing here is auto-instrumentable: these are one-shot ESM
      // processes with no HTTP server, and the only outbound call
      // (diesel.ts's fetch) is Node's global fetch (undici), which
      // instrumentation-http does not patch. Disabling everything avoids
      // paying for auto-instrumentation this stack cannot use.
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

// Wraps a cron entrypoint's main() call. The flush in `finally` is the
// whole point: an ACA Job process that returns from main() exits
// immediately, and the exporter's batch (buffered spans) would otherwise
// never be sent -- there is no server keeping the process alive to flush on
// a timer, unlike apps/api.
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
