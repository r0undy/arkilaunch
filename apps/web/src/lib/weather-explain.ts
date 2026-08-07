import { DEFAULT_WEATHER_THRESHOLDS, type WeatherObservation, type WeatherSeverity, type WeatherThresholds } from '@arkilaunch/shared';

// Turns one observed reading + its computed severity into the sentences a
// human needs to trust the conclusion: both the wind and rainfall numbers,
// each compared against the actual threshold that matters for it, worded to
// reflect how close (or not) the reading actually is -- a calm day and a
// stormy day never produce the same sentence with different numbers
// swapped in. Pure, no IO, so it's testable without rendering anything.
export function explainAdvisory(
  observed: WeatherObservation,
  severity: WeatherSeverity,
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): string[] {
  const windLine = describeReading({
    label: 'Wind',
    value: observed.windKph,
    unit: 'kph',
    watch: thresholds.windKphWatch,
    warning: thresholds.windKphWarning,
  });
  const rainLine = describeReading({
    label: 'Rainfall',
    value: observed.precipMm,
    unit: 'mm',
    watch: thresholds.precipMmWatch,
    warning: thresholds.precipMmWarning,
  });

  const lines = [windLine, rainLine];
  if (severity === 'none') {
    lines.push('Both readings are under the watch threshold; no advisory in effect.');
  } else if (severity === 'watch') {
    lines.push('At least one reading has crossed the watch threshold; monitor conditions.');
  } else {
    lines.push('At least one reading has crossed the warning threshold; consider suspending site work.');
  }
  return lines;
}

function describeReading(args: { label: string; value: number; unit: string; watch: number; warning: number }): string {
  const { label, value, unit, watch, warning } = args;
  if (value >= warning) {
    return `${label}: ${value} ${unit} — above the ${warning} ${unit} warning threshold.`;
  }
  if (value >= watch) {
    return `${label}: ${value} ${unit} — above the ${watch} ${unit} watch threshold, below the ${warning} ${unit} warning threshold.`;
  }
  const margin = watch - value;
  const closeness = margin <= watch * 0.15 ? 'just under' : 'well under';
  return `${label}: ${value} ${unit} — ${closeness} the ${watch} ${unit} watch threshold.`;
}
