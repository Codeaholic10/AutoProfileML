import { Badge } from "@/components/ui/badge";
import type { PreprocessingPlan, PreprocessingStepKind } from "@/types/api";

const STEP_LABELS: Record<PreprocessingStepKind, string> = {
  numeric_impute: "Numeric imputation",
  categorical_impute: "Categorical imputation",
  iqr_clip: "IQR clipping",
  one_hot_encode: "One-hot encoding",
  target_encode: "Target encoding",
  standard_scale: "Standard scaling",
  drop: "Dropped columns",
};

function featureGroups(plan: PreprocessingPlan): { label: string; values: string[] }[] {
  return [
    { label: "Numeric", values: plan.numeric_features },
    { label: "Categorical", values: plan.categorical_features },
    { label: "One-hot encoded", values: plan.one_hot_encoding },
    { label: "Target encoded", values: plan.target_encoding },
    { label: "Excluded", values: plan.excluded_features },
  ];
}

/** What the fold-safe preprocessing pipeline actually did, as fitted. */
export function PreprocessingPlanPanel({ plan }: { plan: PreprocessingPlan }) {
  const groups = featureGroups(plan).filter((group) => group.values.length > 0);

  return (
    <section aria-labelledby="preprocessing-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="preprocessing-heading" className="text-lg font-semibold">
          Preprocessing
        </h2>
        <p className="text-sm text-muted-foreground">
          Each transformer is fitted inside the cross-validation folds, never on the
          full dataset.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-medium">Feature groups</h3>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No features were partitioned for this run.
            </p>
          ) : (
            <dl className="space-y-2 text-sm">
              {groups.map((group) => (
                <div key={group.label} className="flex flex-wrap items-start gap-2">
                  <dt className="w-32 shrink-0 text-muted-foreground">{group.label}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {group.values.map((value) => (
                      <Badge key={value} variant="outline" className="font-normal">
                        {value}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-medium">Steps</h3>
          {plan.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps were recorded.</p>
          ) : (
            <ol className="space-y-3 text-sm">
              {plan.steps.map((step, index) => (
                <li key={`${step.kind}-${index}`} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{STEP_LABELS[step.kind]}</span>
                    {step.strategy ? (
                      <Badge variant="secondary" className="font-normal">
                        {step.strategy}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground">
                    {step.columns.length > 0
                      ? step.columns.join(", ")
                      : "No columns"}
                  </p>
                  {Object.keys(step.parameters).length > 0 ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      {Object.entries(step.parameters)
                        .map(([key, value]) => `${key}=${String(value)}`)
                        .join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {plan.notes.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
