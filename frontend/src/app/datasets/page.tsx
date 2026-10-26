import { DatabaseIcon } from "lucide-react";

export default function DatasetsPage() {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Datasets</h1>
        <p className="text-sm text-muted-foreground">
          Every dataset you upload, with its profile status and latest job.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <DatabaseIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="font-medium">No datasets yet</p>
          <p className="text-sm text-muted-foreground">
            Upload a CSV or Parquet file to create your first profile.
          </p>
        </div>
      </div>
    </section>
  );
}
