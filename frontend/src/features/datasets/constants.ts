/** Client-side upload constraints, kept in sync with the backend defaults. */

export const ACCEPTED_FILE_EXTENSIONS = [".csv", ".parquet", ".pq"] as const;

const DEFAULT_MAX_UPLOAD_MB = 200;

function readMaxUploadMb(): number {
  const configured = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_UPLOAD_MB;
}

export const MAX_UPLOAD_MB = readMaxUploadMb();
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
