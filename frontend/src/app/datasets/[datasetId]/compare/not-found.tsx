import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function CompareNotFound() {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Comparison not found
        </h1>
        <p className="text-sm text-muted-foreground">
          One of the selected benchmark runs does not exist, or it belongs to a
          different dataset.
        </p>
      </div>
      <Link href="/datasets" className={cn(buttonVariants({ variant: "outline" }))}>
        Back to datasets
      </Link>
    </section>
  );
}
