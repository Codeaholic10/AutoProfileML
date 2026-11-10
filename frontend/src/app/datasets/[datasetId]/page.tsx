import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiError } from "@/lib/api/client";
import { getDataset } from "@/lib/api/endpoints";
import { formatBytes, formatCount, formatDateTime } from "@/lib/format";
import type { DatasetSummary } from "@/types/api";

/**
 * Minimal dataset landing page for Phase 4 navigation.
 *
 * Phase 5 replaces this with the profile dashboard (header actions, job
 * progress, statistics, warnings, charts).
 */
export default async function DatasetDetailPage({
  params,
}: PageProps<"/datasets/[datasetId]">) {
  const { datasetId } = await params;

  let dataset: DatasetSummary;
  try {
    dataset = await getDataset(datasetId);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) {
      notFound();
    }
    throw caught;
  }

  const shape =
    dataset.row_count !== null && dataset.column_count !== null
      ? `${formatCount(dataset.row_count)} rows × ${formatCount(dataset.column_count)} columns`
      : "Not profiled yet";

  return (
    <section className="space-y-6">
      <Link
        href="/datasets"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All datasets
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {dataset.filename}
          </h1>
          <Badge variant="outline">{dataset.format.toUpperCase()}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Uploaded {formatDateTime(dataset.uploaded_at)}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border p-4 text-sm sm:grid-cols-4">
        <div className="space-y-1">
          <dt className="text-muted-foreground">Size</dt>
          <dd className="font-medium">{formatBytes(dataset.size_bytes)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Shape</dt>
          <dd className="font-medium">{shape}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Format</dt>
          <dd className="font-medium">{dataset.format.toUpperCase()}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Dataset ID</dt>
          <dd className="truncate font-mono text-xs">{dataset.dataset_id}</dd>
        </div>
      </dl>
    </section>
  );
}
