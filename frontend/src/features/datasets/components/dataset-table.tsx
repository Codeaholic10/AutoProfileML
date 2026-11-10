import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatCount, formatDateTime } from "@/lib/format";
import type { DatasetListItem, JobStatus } from "@/types/api";

import { DeleteDatasetDialog } from "./delete-dataset-dialog";

const JOB_STATUS_VARIANT: Record<
  JobStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  running: "secondary",
  succeeded: "default",
  failed: "destructive",
};

export function DatasetTable({ items }: { items: DatasetListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">Uploaded datasets</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Dataset</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Shape</TableHead>
            <TableHead>Profile</TableHead>
            <TableHead>Latest job</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(({ dataset, has_profile, latest_job }) => {
            const shape =
              dataset.row_count !== null && dataset.column_count !== null
                ? `${formatCount(dataset.row_count)} × ${formatCount(dataset.column_count)}`
                : "—";

            return (
              <TableRow key={dataset.dataset_id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/datasets/${dataset.dataset_id}`}
                      className="font-medium hover:underline"
                    >
                      {dataset.filename}
                    </Link>
                    <Badge variant="outline">{dataset.format.toUpperCase()}</Badge>
                  </div>
                </TableCell>
                <TableCell>{formatBytes(dataset.size_bytes)}</TableCell>
                <TableCell>{shape}</TableCell>
                <TableCell>
                  <Badge variant={has_profile ? "secondary" : "outline"}>
                    {has_profile ? "Available" : "Pending"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {latest_job ? (
                    <Badge variant={JOB_STATUS_VARIANT[latest_job.status]}>
                      {latest_job.status}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(dataset.uploaded_at)}
                </TableCell>
                <TableCell className="text-right">
                  <DeleteDatasetDialog
                    datasetId={dataset.dataset_id}
                    filename={dataset.filename}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
