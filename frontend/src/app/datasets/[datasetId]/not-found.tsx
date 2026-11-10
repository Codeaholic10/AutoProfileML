import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DatasetNotFound() {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dataset not found</h1>
        <p className="text-sm text-muted-foreground">
          This dataset does not exist. It may have been deleted.
        </p>
      </div>
      <Link href="/datasets" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to datasets
      </Link>
    </section>
  );
}
