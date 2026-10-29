/**
 * Display formatting helpers.
 *
 * All output is locale-independent (explicit "en-US" where Intl is used) so
 * tests and screenshots stay stable across machines.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BYTES_PER_UNIT = 1024;
const EMPTY_VALUE = "—";

const countFormatter = new Intl.NumberFormat("en-US");
const metricFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function isUsableNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Format a byte count using binary (1024-based) units. */
export function formatBytes(bytes: number): string {
  if (!isUsableNumber(bytes)) {
    return EMPTY_VALUE;
  }
  if (bytes < BYTES_PER_UNIT) {
    return `${Math.round(bytes)} B`;
  }

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / BYTES_PER_UNIT ** exponent;
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const unit = BYTE_UNITS[exponent] ?? BYTE_UNITS[BYTE_UNITS.length - 1];
  return `${Number(value.toFixed(digits))} ${unit}`;
}

/** Format an already-percentage value (0–100) with a trailing `%`. */
export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  return `${value.toFixed(fractionDigits)}%`;
}

/** Format an integer count with thousands separators. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  return countFormatter.format(value);
}

/** Render an ISO-8601 timestamp as `YYYY-MM-DD HH:mm UTC`. */
export function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_VALUE;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

/** Format a duration in milliseconds. */
export function formatDuration(milliseconds: number): string {
  if (!isUsableNumber(milliseconds)) {
    return EMPTY_VALUE;
  }
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`;
  }
  if (milliseconds < 60_000) {
    return `${(milliseconds / 1000).toFixed(2)} s`;
  }
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/** Format a model metric (accuracy, F1, RMSE, …) with up to 4 decimals. */
export function formatMetric(value: number): string {
  if (!Number.isFinite(value)) {
    return EMPTY_VALUE;
  }
  return metricFormatter.format(value);
}
