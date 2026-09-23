"use client";

import { useCallback } from "react";
import { api, mediaUrl } from "@/lib/api";
import { invalidateMedia } from "@/lib/store";
import { formatBytes, plural } from "@/lib/format";
import { useToast } from "@/components/providers/ToastProvider";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { ARCHIVE_LIMITS, type Media } from "@/lib/types";

function triggerDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Trash / restore / permanent delete / download, with honest feedback. `onRemoved` updates lists optimistically. */
export function useMediaActions(onRemoved?: (ids: string[]) => void) {
  const toast = useToast();
  const confirm = useConfirm();

  const restore = useCallback(async (ids: string[], quiet = false) => {
    try {
      const r = await api<{ ids: string[] }>("/api/media/actions", { method: "POST", json: { action: "restore", ids } });
      onRemoved?.(r.ids);
      invalidateMedia();
      if (!quiet) toast({ title: r.ids.length === 1 ? "File restored" : `${r.ids.length} files restored`, description: "Returned to the original folder where it still exists, otherwise to All media." });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't restore", description: (e as Error).message });
    }
  }, [toast, onRemoved]);

  const trash = useCallback(async (ids: string[]) => {
    try {
      const r = await api<{ ids: string[] }>("/api/media/actions", { method: "POST", json: { action: "trash", ids } });
      onRemoved?.(r.ids);
      invalidateMedia();
      toast({
        title: r.ids.length === 1 ? "Moved to Trash" : `${r.ids.length} files moved to Trash`,
        description: "Removed for everyone with access. You can restore from Trash.",
        action: { label: "Undo", onClick: () => { restore(r.ids, true).then(() => toast({ title: "Restored" })); } },
        duration: 8000,
      });
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't move to Trash", description: (e as Error).message });
      return false;
    }
  }, [toast, onRemoved, restore]);

  const purge = useCallback(async (ids: string[] | "all", names?: string) => {
    const count = ids === "all" ? null : ids.length;
    const ok = await confirm({
      tone: "danger",
      title: ids === "all" ? "Empty Trash?" : count === 1 ? "Delete this file permanently?" : `Delete ${count} files permanently?`,
      description: (
        <>
          {names ? <strong className="confirm-file">{names}</strong> : null}
          {ids === "all" ? "Every file in Trash" : count === 1 ? "The file" : "These files"} and {ids === "all" || count !== 1 ? "their previews" : "its preview"} will be permanently removed for everyone. This can&rsquo;t be undone.
        </>
      ),
      confirmLabel: ids === "all" ? "Empty Trash" : "Delete permanently",
    });
    if (!ok) return false;
    try {
      const r = await api<{ ids: string[] }>("/api/media/actions", { method: "POST", json: ids === "all" ? { action: "purge", all: true } : { action: "purge", ids } });
      onRemoved?.(r.ids);
      invalidateMedia();
      toast({ title: r.ids.length === 1 ? "Deleted permanently" : `${r.ids.length} files deleted permanently` });
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't delete", description: (e as Error).message });
      return false;
    }
  }, [confirm, toast, onRemoved]);

  /** One file downloads directly; several are prepared on the server and streamed as a zip. */
  const download = useCallback(async (items: Media[]) => {
    if (items.length === 1) { triggerDownload(mediaUrl.download(items[0])); return; }
    if (items.length > ARCHIVE_LIMITS.maxFiles) {
      toast({ tone: "error", title: "Too many files for one download", description: `Downloads are limited to ${ARCHIVE_LIMITS.maxFiles} files (and 4 GB) at a time. Select fewer files.` });
      return;
    }
    toast({ tone: "info", title: `Preparing ${plural(items.length, "file")}…`, description: "Checking the files before the zip download starts.", duration: 3000 });
    try {
      const r = await api<{ token: string; count: number; bytes: number }>("/api/media/archive", { method: "POST", json: { ids: items.map((m) => m.id) } });
      triggerDownload(`/api/media/archive/${r.token}`);
      toast({ title: "Download started", description: `${plural(r.count, "file")} · ${formatBytes(r.bytes)} as a zip. Your browser shows its progress.` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't prepare the download", description: (e as Error).message });
    }
  }, [toast]);

  return { trash, restore, purge, download };
}
