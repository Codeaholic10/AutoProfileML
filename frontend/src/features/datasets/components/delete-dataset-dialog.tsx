"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { useDeleteDataset } from "@/lib/api/hooks";

interface DeleteDatasetDialogProps {
  datasetId: string;
  filename: string;
  /** Navigate here after deletion instead of refreshing the current route. */
  redirectTo?: string;
}

export function DeleteDatasetDialog({
  datasetId,
  filename,
  redirectTo,
}: DeleteDatasetDialogProps) {
  const router = useRouter();
  const mutation = useDeleteDataset();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    if (mutation.isPending) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      setError(null);
    }
  }

  function handleDelete() {
    setError(null);
    mutation.mutate(datasetId, {
      onSuccess: () => {
        setOpen(false);
        toast.success(`Deleted ${filename}`);
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.refresh();
        }
      },
      onError: (caught) => {
        setError(
          caught instanceof ApiError
            ? caught.detail
            : "Could not delete the dataset.",
        );
      },
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${filename}`}
          />
        }
      >
        <Trash2Icon aria-hidden="true" />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete dataset?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes{" "}
            <span className="font-medium text-foreground">{filename}</span> and
            its stored profile.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={handleDelete}
          >
            {mutation.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
