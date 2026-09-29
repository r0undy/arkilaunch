import { useAzureMonitor, shutdownAzureMonitor, type AzureMonitorOpenTelemetryOptions } from '@azure/monitor-opentelemetry';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { redactAttributes } from '@arkilaunch/shared';

// Redacts in BOTH hooks so a signed Storage URL's token never reaches App Insights (RA 10173), whatever the processor order.
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

// useAzureMonitor() THROWS without a connection string; telemetry must never be the reason the API fails to boot.
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
        // Unused: this repo's postgres.js isn't touched by instrumentation-pg.
        postgreSql: { enabled: false },
        mongoDb: { enabled: false },
        mySql: { enabled: false },
        redis: { enabled: false },
        redis4: { enabled: false },
        azureSdk: { enabled: false },
        // Container Apps already ships stdout to Log Analytics; this would double-bill every log.
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
