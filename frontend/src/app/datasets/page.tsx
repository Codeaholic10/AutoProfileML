import type { Metadata } from "next";
import { DatabaseIcon } from "lucide-react";

import { DatasetTable } from "@/features/datasets/components/dataset-table";
import { UploadDropzone } from "@/features/datasets/components/upload-dropzone";
import { listDatasets } from "@/lib/api/endpoints";

export const metadata: Metadata = {
  title: "Datasets",
};

export default async function DatasetsPage() {
  const items = await listDatasets();

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Datasets</h1>
        <p className="text-sm text-muted-foreground">
          Every dataset you upload, with its profile status and latest job.
        </p>
      </header>

      <UploadDropzone />

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <DatabaseIcon aria-hidden="true" className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">No datasets yet</p>
            <p className="text-sm text-muted-foreground">
              Upload a CSV or Parquet file above to create your first profile.
            </p>
          </div>
        </div>
      ) : (
        <DatasetTable items={items} />
      )}
    </section>
  );
}
