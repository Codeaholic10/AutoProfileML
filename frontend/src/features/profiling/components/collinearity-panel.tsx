import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMetric } from "@/lib/format";
import type { CollinearityFinding, CollinearitySeverity } from "@/types/api";

const SEVERITY_VARIANT: Record<
  CollinearitySeverity,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ok: "outline",
  moderate: "secondary",
  severe: "destructive",
};

export function CollinearityPanel({
  findings,
}: {
  findings: CollinearityFinding[];
}) {
  return (
    <section aria-labelledby="collinearity-heading" className="space-y-3">
      <h2 id="collinearity-heading" className="text-lg font-semibold">
        Multicollinearity (VIF)
      </h2>
      {findings.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          A collinearity check needs at least two numeric features.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableCaption className="sr-only">
              Variance inflation factors per numeric feature
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead className="text-right">VIF</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Correlated with</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((finding) => (
                <TableRow key={finding.feature}>
                  <TableCell className="font-medium">{finding.feature}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMetric(finding.vif)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={SEVERITY_VARIANT[finding.severity]}>
                      {finding.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {finding.correlated_with ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
