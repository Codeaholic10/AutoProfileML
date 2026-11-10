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
import type { OutOfFoldPredictions } from "@/types/api";

import { highestConfidenceMistakes } from "../analysis";

/** The most confident misclassifications in the out-of-fold sample. */
export function WrongPredictionsTable({
  predictions,
}: {
  predictions: OutOfFoldPredictions;
}) {
  const mistakes = highestConfidenceMistakes(predictions);

  if (mistakes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
        No misclassifications in the out-of-fold sample.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">
          Highest-confidence wrong predictions from the out-of-fold sample
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Row</TableHead>
            <TableHead>True label</TableHead>
            <TableHead>Predicted</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mistakes.map((mistake) => (
            <TableRow key={mistake.rowIndex}>
              <TableCell className="tabular-nums">{mistake.rowIndex}</TableCell>
              <TableCell>{mistake.yTrue}</TableCell>
              <TableCell>{mistake.yPred}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatMetric(mistake.confidence)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
