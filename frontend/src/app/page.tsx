import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <section className="flex flex-col items-start gap-6 py-12">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">AutoProfileML</h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Upload a dataset to profile its columns, then benchmark machine-learning
          models against it. Every number is traceable back to the data it came
          from.
        </p>
      </div>
      <Link href="/datasets" className={buttonVariants({ size: "lg" })}>
        Browse datasets
      </Link>
    </section>
  );
}
