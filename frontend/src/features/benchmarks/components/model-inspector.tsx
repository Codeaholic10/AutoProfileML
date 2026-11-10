"use client";

import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { usePredictions } from "@/lib/api/hooks";
import { formatCount } from "@/lib/format";
import type { BenchmarkRun } from "@/types/api";

import { succeededModels } from "../metrics";
import { ConfusionMatrixView } from "./confusion-matrix";
import { RocCurveChart } from "./roc-curve-chart";
import { WrongPredictionsTable } from "./wrong-predictions-table";

const selectClassName =
  "h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Per-model out-of-fold diagnostics: confusion matrix, ROC curves, and the
 * highest-confidence mistakes. Classification only.
 */
export function ModelInspector({ run }: { run: BenchmarkRun }) {
  const models = succeededModels(run);
  const [modelId, setModelId] = useState(
    run.best_model_id ?? models[0]?.model_id ?? "",
  );

  if (run.task_type === "regression") {
    return (
      <section aria-labelledby="diagnostics-heading" className="space-y-3">
        <h2 id="diagnostics-heading" className="text-lg font-semibold">
          Model diagnostics
        </h2>
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Confusion matrices, ROC curves, and the mistakes table are
          classification-only. This run is regression — compare RMSE, MAE, and R²
          in the leaderboard above.
        </p>
      </section>
    );
  }

  if (models.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="diagnostics-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 id="diagnostics-heading" className="text-lg font-semibold">
            Model diagnostics
          </h2>
          <p className="text-sm text-muted-foreground">
            Everything here comes from out-of-fold predictions, not from a
            refit-on-full-data model.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="diagnostics-model" className="text-xs text-muted-foreground">
            Model
          </label>
          <select
            id="diagnostics-model"
            className={selectClassName}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          >
            {models.map((model) => (
              <option key={model.model_id} value={model.model_id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ModelDiagnostics benchmarkId={run.benchmark_id} modelId={modelId} />
    </section>
  );
}

function ModelDiagnostics({
  benchmarkId,
  modelId,
}: {
  benchmarkId: string;
  modelId: string;
}) {
  const query = usePredictions(benchmarkId, modelId);

  if (query.isPending) {
    return <Skeleton aria-label="Loading predictions" className="h-64 w-full rounded-xl" />;
  }

  if (query.isError) {
    return (
      <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {query.error instanceof ApiError
          ? query.error.detail
          : "Could not load out-of-fold predictions."}
      </p>
    );
  }

  const predictions = query.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Confusion matrix</h3>
          <ConfusionMatrixView predictions={predictions} />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">ROC curves</h3>
          <RocCurveChart predictions={predictions} />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Highest-confidence mistakes</h3>
        <WrongPredictionsTable predictions={predictions} />
      </div>

      <p className="text-xs text-muted-foreground">
        {formatCount(predictions.prediction_count)} out-of-fold predictions
        {predictions.truncated
          ? " (capped — the stored sample is a deterministic head slice)."
          : "."}
      </p>
    </div>
  );
}
