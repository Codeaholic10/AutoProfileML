import { Skeleton } from "@/components/ui/skeleton";

export default function BenchmarkLoading() {
  return (
    <div aria-busy="true" aria-label="Loading benchmark" className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  );
}
