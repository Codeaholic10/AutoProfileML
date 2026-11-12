"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ApiError } from "@/lib/api/client";
import { useCreateBenchmark } from "@/lib/api/hooks";
import type {
  BenchmarkCreateRequest,
  CollinearityFinding,
  ColumnProfile,
} from "@/types/api";

import { suggestExclusions } from "../recommendations";

const formSchema = z.object({
  target: z.string().min(1, "Choose a target column."),
  taskType: z.enum(["auto", "classification", "regression"]),
  folds: z
    .number()
    .int("Folds must be a whole number.")
    .min(3, "Use at least 3 folds.")
    .max(10, "Use at most 10 folds."),
  sampleCap: z.enum(["all", "10000", "50000", "100000"]),
  excluded: z.array(z.string()),
});

type FormValues = z.infer<typeof formSchema>;

interface BenchmarkFormProps {
  datasetId: string;
  columns: ColumnProfile[];
  collinearity: CollinearityFinding[];
  rowCount: number;
}

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Queue a benchmark run for a target column. */
export function BenchmarkForm({
  datasetId,
  columns,
  collinearity,
  rowCount,
}: BenchmarkFormProps) {
  const router = useRouter();
  const mutation = useCreateBenchmark();
  const recommendations = useMemo(
    () => suggestExclusions(columns, collinearity, rowCount),
    [columns, collinearity, rowCount],
  );
  const recommendationReasons = new Map(
    recommendations.map((item) => [item.column, item.reason]),
  );

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      target: "",
      taskType: "auto",
      folds: 5,
      sampleCap: "all",
      excluded: [],
    },
  });

  const target = useWatch({ control, name: "target" });
  const selected = useWatch({ control, name: "excluded" });
  const excluded = selected ?? [];
  const pending = mutation.isPending;

  function toggleExcluded(column: string, checked: boolean) {
    const next = checked
      ? [...excluded, column]
      : excluded.filter((name) => name !== column);
    setValue("excluded", [...new Set(next)], { shouldDirty: true });
  }

  function selectRecommended() {
    const next = new Set(excluded);
    for (const suggestion of recommendations) {
      if (suggestion.column !== target) {
        next.add(suggestion.column);
      }
    }
    setValue("excluded", [...next], { shouldDirty: true });
  }

  function onSubmit(values: FormValues) {
    const request: BenchmarkCreateRequest = {
      target: values.target,
      task_type: values.taskType === "auto" ? null : values.taskType,
      excluded_features: values.excluded.filter((name) => name !== values.target),
      folds: values.folds,
      sample_cap: values.sampleCap === "all" ? null : Number(values.sampleCap),
    };
    mutation.mutate(
      { datasetId, request },
      {
        onSuccess: (response) => {
          toast.success("Benchmark queued");
          router.push(
            `/benchmarks/${response.benchmark.benchmark_id}?job=${response.job.job_id}`,
          );
        },
        onError: (caught) => {
          toast.error(
            caught instanceof ApiError
              ? caught.detail
              : "Could not queue the benchmark.",
          );
        },
      },
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      aria-labelledby="benchmark-form-heading"
      className="space-y-4 rounded-xl border p-4"
    >
      <div className="space-y-1">
        <h3 id="benchmark-form-heading" className="text-sm font-medium">
          Run a benchmark
        </h3>
        <p className="text-sm text-muted-foreground">
          Four models are cross-validated on the target. Preprocessing is fitted
          inside every fold.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor="benchmark-target" className="text-xs text-muted-foreground">
            Target column
          </label>
          <select
            id="benchmark-target"
            className={selectClassName}
            aria-invalid={errors.target !== undefined}
            {...register("target")}
          >
            <option value="">Choose a column…</option>
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name} ({column.semantic_type})
              </option>
            ))}
          </select>
          {errors.target ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.target.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label htmlFor="benchmark-task" className="text-xs text-muted-foreground">
            Task type
          </label>
          <select
            id="benchmark-task"
            className={selectClassName}
            {...register("taskType")}
          >
            <option value="auto">Auto-detect</option>
            <option value="classification">Classification</option>
            <option value="regression">Regression</option>
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="benchmark-folds" className="text-xs text-muted-foreground">
            Cross-validation folds
          </label>
          <select
            id="benchmark-folds"
            className={selectClassName}
            {...register("folds", { valueAsNumber: true })}
          >
            {Array.from({ length: 8 }, (_unused, index) => index + 3).map((folds) => (
              <option key={folds} value={folds}>
                {folds}
              </option>
            ))}
          </select>
          {errors.folds ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.folds.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label htmlFor="benchmark-sample" className="text-xs text-muted-foreground">
            Training rows
          </label>
          <select
            id="benchmark-sample"
            className={selectClassName}
            {...register("sampleCap")}
          >
            <option value="all">All (max 250,000)</option>
            <option value="10000">10,000</option>
            <option value="50000">50,000</option>
            <option value="100000">100,000</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Excluded features</legend>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Excluded features ({excluded.length} selected)
          </p>
          {recommendations.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={selectRecommended}
            >
              Select recommended ({recommendations.length})
            </Button>
          ) : null}
        </div>
        <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
          {columns.map((column) => {
            const reason = recommendationReasons.get(column.name);
            return (
              <label
                key={column.name}
                htmlFor={`exclude-${column.name}`}
                className="flex items-start gap-2 text-sm"
              >
                <Checkbox
                  id={`exclude-${column.name}`}
                  checked={excluded.includes(column.name)}
                  onCheckedChange={(checked) =>
                    toggleExcluded(column.name, checked === true)
                  }
                />
                <span className="space-y-0.5">
                  <span className="block font-mono text-xs">{column.name}</span>
                  {reason ? (
                    <span className="block text-xs text-muted-foreground">
                      recommended: {reason}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2Icon aria-hidden="true" className="animate-spin" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
          {pending ? "Queueing…" : "Run benchmark"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Excluded features are never fed to any model. Task type is inferred from
          the target when set to auto.
        </p>
      </div>
    </form>
  );
}
