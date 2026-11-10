import { Badge } from "@/components/ui/badge";
import type { ProfilingWarning, WarningSeverity } from "@/types/api";

const SEVERITY_ORDER: WarningSeverity[] = ["critical", "warning", "info"];

const SEVERITY_VARIANT: Record<
  WarningSeverity,
  "default" | "secondary" | "destructive" | "outline"
> = {
  critical: "destructive",
  warning: "secondary",
  info: "outline",
};

export function WarningsPanel({ warnings }: { warnings: ProfilingWarning[] }) {
  if (warnings.length === 0) {
    return (
      <section aria-labelledby="warnings-heading" className="space-y-3">
        <h2 id="warnings-heading" className="text-lg font-semibold">
          Warnings
        </h2>
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          No data-quality warnings detected.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="warnings-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 id="warnings-heading" className="text-lg font-semibold">
          Warnings
        </h2>
        <Badge variant="secondary">{warnings.length}</Badge>
      </div>

      <div className="space-y-2">
        {SEVERITY_ORDER.map((severity) => {
          const group = warnings.filter(
            (warning) => warning.severity === severity,
          );
          if (group.length === 0) {
            return null;
          }

          return (
            <details key={severity} open className="rounded-xl border">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
                <Badge variant={SEVERITY_VARIANT[severity]}>
                  <span className="capitalize">{severity}</span>
                </Badge>
                <span>
                  {group.length} {group.length === 1 ? "warning" : "warnings"}
                </span>
              </summary>
              <ul className="space-y-3 border-t px-4 py-3">
                {group.map((warning, index) => (
                  <li
                    key={`${warning.code}-${warning.column ?? "dataset"}-${index}`}
                    className="space-y-1 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {warning.code}
                      </code>
                      {warning.column ? (
                        <span className="font-medium">{warning.column}</span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground">{warning.message}</p>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}
