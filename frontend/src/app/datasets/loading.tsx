import { Skeleton } from "@/components/ui/skeleton";

export default function DatasetsLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading datasets"
      className="space-y-8"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </section>
  );
}
