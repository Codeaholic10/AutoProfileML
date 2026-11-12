"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function CompareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Compare benchmarks
        </h1>
        <p role="alert" className="text-sm text-destructive">
          Could not load the comparison. Check that the API is running and try
          again.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
