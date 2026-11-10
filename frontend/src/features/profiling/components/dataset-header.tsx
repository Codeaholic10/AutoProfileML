import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteDatasetDialog } from "@/features/datasets/components/delete-dataset-dialog";
import { formatBytes, formatCount, formatDateTime } from "@/lib/format";
import type { DatasetSummary } from "@/types/api";

import { ReprofileButton } from "./reprofile-button";

export function DatasetHeader({ dataset }: { dataset: DatasetSummary }) {
  const shape =
    dataset.row_count !== null && dataset.column_count !== null
      ? `${formatCount(dataset.row_count)} rows × ${formatCount(dataset.column_count)} columns`
      : "Not profiled yet";

  return (
    <section className="space-y-4">
      <Link
        href="/datasets"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← All datasets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {dataset.filename}
            </h1>
            <Badge variant="outline">{dataset.format.toUpperCase()}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {shape} · {formatBytes(dataset.size_bytes)} · Uploaded{" "}
            {formatDateTime(dataset.uploaded_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReprofileButton datasetId={dataset.dataset_id} />
          <Button
            variant="outline"
            disabled
            title="Benchmarking arrives with the model arena."
          >
            Benchmark
          </Button>
          <DeleteDatasetDialog
            datasetId={dataset.dataset_id}
            filename={dataset.filename}
            redirectTo="/datasets"
          />
        </div>
      </div>
    </section>
  );
}
