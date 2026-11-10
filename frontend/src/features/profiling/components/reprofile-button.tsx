"use client";

import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { useReprofileDataset } from "@/lib/api/hooks";

interface ReprofileButtonProps {
  datasetId: string;
  label?: string;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
}

export function ReprofileButton({
  datasetId,
  label = "Re-profile",
  variant = "outline",
  size = "default",
}: ReprofileButtonProps) {
  const router = useRouter();
  const mutation = useReprofileDataset();

  function handleClick() {
    mutation.mutate(datasetId, {
      onSuccess: () => {
        toast.success("Profiling queued");
        router.refresh();
      },
      onError: (caught) => {
        toast.error(
          caught instanceof ApiError
            ? caught.detail
            : "Could not queue profiling.",
        );
      },
    });
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? (
        <Loader2Icon aria-hidden="true" className="animate-spin" />
      ) : (
        <RefreshCwIcon aria-hidden="true" />
      )}
      {mutation.isPending ? "Queueing…" : label}
    </Button>
  );
}
