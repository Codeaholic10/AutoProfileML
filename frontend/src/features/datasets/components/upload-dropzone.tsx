"use client";

import { FileUpIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ApiError } from "@/lib/api/client";
import { useUploadDataset } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

import {
  ACCEPTED_FILE_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
} from "../constants";

const ACCEPTED_MIME_TYPES: Record<string, string[]> = {
  "text/csv": [".csv"],
  "application/vnd.apache.parquet": [".parquet", ".pq"],
  "application/octet-stream": [".parquet", ".pq"],
};

function describeRejections(rejections: FileRejection[]): string {
  const codes = new Set(
    rejections.flatMap((rejection) => rejection.errors.map((issue) => issue.code)),
  );
  if (codes.has("file-too-large")) {
    return `File is larger than ${MAX_UPLOAD_MB} MB.`;
  }
  if (codes.has("file-invalid-type")) {
    return `Only ${ACCEPTED_FILE_EXTENSIONS.join(", ")} files are supported.`;
  }
  if (codes.has("too-many-files")) {
    return "Upload one file at a time.";
  }
  return "This file cannot be uploaded.";
}

export function UploadDropzone() {
  const router = useRouter();
  const mutation = useUploadDataset();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: ACCEPTED_MIME_TYPES,
    maxSize: MAX_UPLOAD_BYTES,
    maxFiles: 1,
    multiple: false,
    disabled: mutation.isPending,
    onDrop: (acceptedFiles, rejections) => {
      setError(null);
      setProgress(null);
      if (rejections.length > 0) {
        setError(describeRejections(rejections));
        return;
      }
      const file = acceptedFiles[0];
      if (!file) {
        return;
      }
      mutation.mutate(
        { file, onProgress: setProgress },
        {
          onSuccess: (response) => {
            toast.success(`Uploaded ${response.dataset.filename}`);
            router.push(`/datasets/${response.dataset.dataset_id}`);
          },
          onError: (caught) => {
            setProgress(null);
            setError(
              caught instanceof ApiError
                ? caught.detail
                : "Upload failed. Please try again.",
            );
          },
        },
      );
    },
  });

  return (
    <section aria-labelledby="upload-heading" className="space-y-2">
      <h2 id="upload-heading" className="text-sm font-medium">
        Upload a dataset
      </h2>
      <div
        {...getRootProps()}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          isDragActive && "border-primary bg-muted/50",
          mutation.isPending && "pointer-events-none opacity-60",
        )}
      >
        <input {...getInputProps()} aria-label="Upload dataset file" />
        {mutation.isPending ? (
          <Loader2Icon
            aria-hidden="true"
            className="size-8 animate-spin text-muted-foreground"
          />
        ) : (
          <FileUpIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        )}
        <div className="space-y-1">
          <p className="font-medium">
            {mutation.isPending
              ? "Uploading and profiling…"
              : "Drag and drop a file here"}
          </p>
          <p className="text-sm text-muted-foreground">
            CSV or Parquet, up to {MAX_UPLOAD_MB} MB
          </p>
        </div>
        {mutation.isPending ? (
          <div className="w-full max-w-sm space-y-1">
            <Progress value={progress} aria-label="Upload progress" />
            <p className="text-xs text-muted-foreground">
              {progress === null
                ? "Uploading…"
                : progress < 100
                  ? `Uploading ${progress}%`
                  : "Upload complete — starting profiling…"}
            </p>
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={mutation.isPending}
          onClick={(event) => {
            // Open explicitly instead of relying on the click bubbling to the
            // dropzone root, which a nested interactive element can swallow.
            event.stopPropagation();
            open();
          }}
        >
          {mutation.isPending ? "Uploading…" : "Choose file"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
