"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatPercent } from "@/lib/format";
import type { ColumnProfile, SemanticType } from "@/types/api";

import { ColumnDetail } from "./column-detail";
import { MissingnessBar } from "./missingness-bar";

type SortKey =
  | "name"
  | "dtype"
  | "null_percentage"
  | "unique_count"
  | "is_constant";
type SortDirection = "asc" | "desc";
type TypeFilter = SemanticType | "all";

const SEMANTIC_TYPES: SemanticType[] = [
  "numeric",
  "categorical",
  "boolean",
  "temporal",
  "unknown",
];

function compareColumns(
  left: ColumnProfile,
  right: ColumnProfile,
  key: SortKey,
): number {
  const leftValue = left[key];
  const rightValue = right[key];
  if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
    return Number(leftValue) - Number(rightValue);
  }
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }
  return String(leftValue).localeCompare(String(rightValue));
}

interface SortableHeadProps {
  activeKey: SortKey;
  direction: SortDirection;
  label: string;
  onSort: (key: SortKey) => void;
  sortKey: SortKey;
  align?: "left" | "right";
}

function SortableHead({
  activeKey,
  direction,
  label,
  onSort,
  sortKey,
  align = "left",
}: SortableHeadProps) {
  const active = activeKey === sortKey;
  return (
    <TableHead
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {label}
        <span aria-hidden="true" className="text-xs">
          {active ? (direction === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </TableHead>
  );
}

export function ColumnTable({ columns }: { columns: ColumnProfile[] }) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<ColumnProfile | null>(null);

  const availableTypes = useMemo(
    () =>
      SEMANTIC_TYPES.filter((type) =>
        columns.some((column) => column.semantic_type === type),
      ),
    [columns],
  );

  const visibleColumns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = columns.filter((column) => {
      const matchesType =
        typeFilter === "all" || column.semantic_type === typeFilter;
      const matchesQuery =
        needle.length === 0 ||
        column.name.toLowerCase().includes(needle) ||
        column.dtype.toLowerCase().includes(needle);
      return matchesType && matchesQuery;
    });

    const sorted = [...filtered].sort((left, right) =>
      compareColumns(left, right, sortKey),
    );
    return direction === "asc" ? sorted : sorted.reverse();
  }, [columns, query, typeFilter, sortKey, direction]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection("asc");
  }

  return (
    <section aria-labelledby="columns-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id="columns-heading" className="text-lg font-semibold">
            Columns
          </h2>
          <Badge variant="secondary">{columns.length}</Badge>
        </div>
        <div className="flex flex-col gap-1">
          <label className="sr-only" htmlFor="column-search">
            Search columns
          </label>
          <Input
            id="column-search"
            placeholder="Search columns…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-56"
          />
        </div>
      </div>

      <div aria-label="Filter by semantic type" className="flex flex-wrap gap-2">
        <Button
          aria-pressed={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
          size="sm"
          variant={typeFilter === "all" ? "default" : "outline"}
        >
          All
        </Button>
        {availableTypes.map((type) => (
          <Button
            key={type}
            aria-pressed={typeFilter === type}
            onClick={() => setTypeFilter(type)}
            size="sm"
            variant={typeFilter === type ? "default" : "outline"}
          >
            {type}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableCaption className="sr-only">Profiled columns</TableCaption>
          <TableHeader>
            <TableRow>
              <SortableHead
                activeKey={sortKey}
                direction={direction}
                label="Name"
                onSort={handleSort}
                sortKey="name"
              />
              <SortableHead
                activeKey={sortKey}
                direction={direction}
                label="Type"
                onSort={handleSort}
                sortKey="dtype"
              />
              <SortableHead
                activeKey={sortKey}
                direction={direction}
                label="Missing %"
                onSort={handleSort}
                sortKey="null_percentage"
              />
              <SortableHead
                activeKey={sortKey}
                direction={direction}
                align="right"
                label="Unique"
                onSort={handleSort}
                sortKey="unique_count"
              />
              <SortableHead
                activeKey={sortKey}
                direction={direction}
                label="Constant"
                onSort={handleSort}
                sortKey="is_constant"
              />
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleColumns.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No columns match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              visibleColumns.map((column) => (
                <TableRow key={column.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{column.name}</span>
                      {column.is_constant ? (
                        <Badge variant="outline">constant</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="block font-mono text-xs">
                      {column.dtype}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {column.semantic_type}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-right text-sm tabular-nums">
                        {formatPercent(column.null_percentage, 2)}
                      </span>
                      <div className="w-20">
                        <MissingnessBar
                          label={column.name}
                          percentage={column.null_percentage}
                        />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(column.unique_count)}
                  </TableCell>
                  <TableCell>{column.is_constant ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      aria-label={`Inspect ${column.name}`}
                      onClick={() => setSelected(column)}
                      size="sm"
                      variant="ghost"
                    >
                      Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ColumnDetail column={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
