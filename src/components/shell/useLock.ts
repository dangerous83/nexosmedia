"use client";

import { useCallback } from "react";
import { api } from "@/lib/api";
import { useUploads } from "@/components/providers/UploadProvider";
import { useConfirm } from "@/components/providers/ConfirmProvider";

/** Ends this device's session on the server and returns to the access screen. */
export function useLock() {
  const { activeCount } = useUploads();
  const confirm = useConfirm();
  return useCallback(async () => {
    if (activeCount > 0) {
      const ok = await confirm({
        tone: "danger",
        title: "Lock while uploads are running?",
        description: `${activeCount} upload${activeCount > 1 ? "s are" : " is"} still in progress and will be canceled. Files that already finished are safe.`,
        confirmLabel: "Lock workspace",
      });
      if (!ok) return;
    }
    try {
      await api("/api/access", { method: "DELETE" });
    } finally {
      window.location.replace("/unlock");
    }
  }, [activeCount, confirm]);
}
