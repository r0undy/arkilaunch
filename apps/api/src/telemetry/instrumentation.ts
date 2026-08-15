import { useAzureMonitor, shutdownAzureMonitor, type AzureMonitorOpenTelemetryOptions } from '@azure/monitor-opentelemetry';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { redactAttributes } from '@arkilaunch/shared';

// Redacts in BOTH hooks: onStart guarantees a signed Supabase Storage URL's
// token query string is gone before any other processor observes it,
// regardless of processor registration order; onEnd catches anything a
// later instrumentation adds. See packages/shared/src/telemetry-redact.ts
// for the actual rules (KYC/EDTR document URLs and their bearer tokens must
// never reach App Insights -- RA 10173).
class RedactingSpanProcessor implements SpanProcessor {
  onStart(span: Span): void {
    redactAttributes(span.attributes as Record<string, unknown>);
  }
  onEnd(span: ReadableSpan): void {
    redactAttributes(span.attributes as Record<string, unknown>);
  }
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

let initialized = false;

// Graceful no-op: APPLICATIONINSIGHTS_CONNECTION_STRING is filtered out of
// the Container App secret map when blank (infra/terraform/environments/*/
// main.tf), and is absent in local dev and CI. useAzureMonitor() THROWS
// "Connection String not found" with no connection string, so this guard is
// load-bearing, not defensive noise -- telemetry must never be the reason
// the API fails to boot.
export function initTelemetry(): void {
  if (initialized) return;
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    console.log('telemetry: APPLICATIONINSIGHTS_CONNECTION_STRING not set; running uninstrumented.');
    return;
  }

  try {
    const options: AzureMonitorOpenTelemetryOptions = {
      azureMonitorExporterOptions: { connectionString },
      instrumentationOptions: {
        http: { enabled: true },
        // Dead weight for this stack: no Mongo/MySQL/Redis, no Azure SDK
        // client on the request path, and this repo uses postgres.js
        // (`postgres`), which instrumentation-pg (mapped from postgreSql
        // here) does not touch at all.
        postgreSql: { enabled: false },
        mongoDb: { enabled: false },
        mySql: { enabled: false },
        redis: { enabled: false },
        redis4: { enabled: false },
        azureSdk: { enabled: false },
        // Container Apps already ships stdout to the same Log Analytics
        // workspace (container_apps_environment wires log_analytics_workspace_id);
        // enabling these would double-bill every console.log/logger call.
        console: { enabled: false },
        winston: { enabled: false },
        bunyan: { enabled: false },
      },
      enablePerformanceCounters: false, // ACA already exposes CPU/memory as free platform metrics
      spanProcessors: [new RedactingSpanProcessor()],
    };
    useAzureMonitor(options);
    initialized = true;
    console.log('telemetry: Azure Monitor enabled.');
  } catch (err) {
    // Telemetry must never be the reason the API fails to boot.
    console.error('telemetry: failed to initialize; continuing uninstrumented.', err);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!initialized) return;
  await shutdownAzureMonitor().catch(() => {});
}
