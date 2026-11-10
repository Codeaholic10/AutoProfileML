"use client";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCount, formatMetric, formatPercent } from "@/lib/format";
import type { ColumnProfile } from "@/types/api";

import { MissingnessBar } from "./missingness-bar";
import { QuartileChart } from "./quartile-chart";
import { TopValuesChart } from "./top-values-chart";

interface ColumnDetailProps {
  column: ColumnProfile | null;
  onClose: () => void;
}

function statValue(value: number | null): string {
  return value === null ? "—" : formatMetric(value);
}

export function ColumnDetail({ column, onClose }: ColumnDetailProps) {
  return (
    <Dialog
      open={column !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {column ? (
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{column.name}</DialogTitle>
            <DialogDescription>
              {column.dtype} · {column.semantic_type}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Missing</dt>
                <dd className="font-medium">
                  {formatCount(column.null_count)} (
                  {formatPercent(column.null_percentage, 2)})
                </dd>
                <MissingnessBar
                  label={column.name}
                  percentage={column.null_percentage}
                />
              </div>
              <div>
                <dt className="text-muted-foreground">Unique values</dt>
                <dd className="font-medium">{formatCount(column.unique_count)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Constant</dt>
                <dd>
                  <Badge variant={column.is_constant ? "secondary" : "outline"}>
                    {column.is_constant ? "Yes" : "No"}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Semantic type</dt>
                <dd className="font-medium">{column.semantic_type}</dd>
              </div>
            </dl>

            {column.semantic_type === "numeric" ? (
              <section aria-label="Numeric statistics" className="space-y-2">
                <h3 className="text-sm font-medium">Numeric statistics</h3>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  {[
                    { label: "Mean", value: column.mean },
                    { label: "Std", value: column.std },
                    { label: "Min", value: column.minimum },
                    { label: "Q1", value: column.q1 },
                    { label: "Median", value: column.median },
                    { label: "Q3", value: column.q3 },
                    { label: "Max", value: column.maximum },
                    { label: "Skewness", value: column.skewness },
                    { label: "Kurtosis", value: column.kurtosis },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <dt className="text-xs text-muted-foreground">
                        {stat.label}
                      </dt>
                      <dd className="tabular-nums">{statValue(stat.value)}</dd>
                    </div>
                  ))}
                </dl>
                <QuartileChart column={column} />
              </section>
            ) : null}

            {column.top_values.length > 0 ? (
              <TopValuesChart
                columnName={column.name}
                values={column.top_values}
              />
            ) : null}
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
