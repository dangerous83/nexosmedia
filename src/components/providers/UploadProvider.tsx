"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { invalidateMedia } from "@/lib/store";
import { CSRF_HEADERS } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { ACCEPT_ATTR, UPLOAD_RULES, type Media, type MediaKind } from "@/lib/types";

/**
 * preparing  → reading the file locally (video metadata / poster frame)
 * queued     → waiting for a free upload slot
 * uploading  → bytes in transit (real progress)
 * processing → all bytes sent; the server is validating, creating the thumbnail and saving
 * finalizing → saved and visible in the gallery; the video preview frame is still being stored
 */
export type UploadStatus = "preparing" | "queued" | "uploading" | "processing" | "finalizing" | "done" | "failed" | "canceled" | "invalid";
export const ACTIVE_STATUSES: UploadStatus[] = ["preparing", "queued", "uploading", "processing", "finalizing"];

export interface UploadTarget { folderId: string | null; label: string }

export interface UploadItem {
  id: string;
  file: File;
  kind: MediaKind | null;
  status: UploadStatus;
  /** Bytes sent / total — reported by the browser's upload progress events. */
  loaded: number;
  total: number;
  error?: string;
  note?: string;
  /** Local object URL — a preview of the file on this device, not proof of upload. */
  preview?: string;
  poster?: Blob;
  meta?: { width?: number; height?: number; duration?: number };
  media?: Media;
  addedAt: number;
  /** Destination captured when the file was added. */
  target: UploadTarget;
}

interface UploadCtx {
  items: UploadItem[];
  addFiles: (files: FileList | File[]) => void;
  openPicker: () => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  trayOpen: boolean;
  setTrayOpen: (v: boolean) => void;
  activeCount: number;
  /** True while files are being dragged over the window. */
  dragging: boolean;
  /** Where new uploads go (follows the open folder). */
  target: UploadTarget;
  setTarget: (t: UploadTarget) => void;
  /** Media ids saved on the server whose preview frame is still being stored. */
  previewPending: Set<string>;
}

const Ctx = createContext<UploadCtx | null>(null);
const CONCURRENCY = 2;
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

function kindOf(file: File): MediaKind | null {
  if ((UPLOAD_RULES.image.mimes as readonly string[]).includes(file.type)) return "image";
  if ((UPLOAD_RULES.video.mimes as readonly string[]).includes(file.type) || file.type === "video/x-m4v") return "video";
  if (!file.type || file.type === "application/octet-stream") {
    const ext = extOf(file.name);
    if ((UPLOAD_RULES.image.exts as readonly string[]).includes(ext)) return "image";
    if ((UPLOAD_RULES.video.exts as readonly string[]).includes(ext)) return "video";
  }
  return null;
}

/** Specific guidance for common formats we don't accept. */
function unsupportedMessage(file: File) {
  const ext = extOf(file.name);
  if (ext === "mov" || file.type === "video/quicktime") return "MOV videos aren't supported. Export or convert the video to MP4.";
  if (ext === "heic" || ext === "heif" || file.type.startsWith("image/hei")) return "HEIC photos aren't supported. Export the photo as JPEG.";
  if (ext === "gif") return "GIF images aren't supported. Convert to PNG or WebP (or MP4 for animation).";
  return `This format isn't supported. Use ${UPLOAD_RULES.image.label} images or ${UPLOAD_RULES.video.label} videos.`;
}

/** Reads duration/size and captures a poster frame in the browser (no server decoder needed). */
function inspectVideo(file: File, url: string): Promise<{ width?: number; height?: number; duration?: number; poster?: Blob; playable: boolean }> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    const done = (r: Awaited<ReturnType<typeof inspectVideo>>) => {
      if (settled) return;
      settled = true;
      v.removeAttribute("src");
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => done({ playable: v.readyState > 0, width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? v.duration : undefined }), 10000);
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onerror = () => { clearTimeout(timer); done({ playable: false }); };
    v.onloadedmetadata = () => {
      const t = Number.isFinite(v.duration) ? Math.min(Math.max(v.duration * 0.1, 0.1), 2) : 0.1;
      v.currentTime = t;
    };
    v.onseeked = () => {
      const meta = { width: v.videoWidth || undefined, height: v.videoHeight || undefined, duration: Number.isFinite(v.duration) ? v.duration : undefined };
      try {
        const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight, 1));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(v.videoWidth * scale));
        c.height = Math.max(1, Math.round(v.videoHeight * scale));
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((blob) => { clearTimeout(timer); done({ ...meta, poster: blob ?? undefined, playable: true }); }, "image/jpeg", 0.86);
      } catch {
        clearTimeout(timer);
        done({ ...meta, playable: true });
      }
    };
    v.src = url;
  });
}

interface Limits { maxImageBytes: number; maxVideoBytes: number; directBlobUpload?: boolean }

export function UploadProvider({ limits, children }: { limits: Limits; children: React.ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [target, setTargetState] = useState<UploadTarget>({ folderId: null, label: "All media" });
  const targetRef = useRef(target);
  targetRef.current = target;
  const setTarget = useCallback((t: UploadTarget) => {
    setTargetState((cur) => (cur.folderId === t.folderId && cur.label === t.label ? cur : t));
  }, []);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const aborters = useRef(new Map<string, AbortController>());
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patch = useCallback((id: string, p: Partial<UploadItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const validate = useCallback((file: File, kind: MediaKind | null): string | null => {
    if (!kind) return unsupportedMessage(file);
    if (file.size === 0) return "This file is empty.";
    const max = kind === "video" ? limits.maxVideoBytes : limits.maxImageBytes;
    if (file.size > max) return `This ${kind} is ${formatBytes(file.size)}. The limit for ${kind}s is ${formatBytes(max, 0)}.`;
    return null;
  }, [limits]);

  const addFiles = useCallback((list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    const next: UploadItem[] = files.map((file) => {
      const kind = kindOf(file);
      const error = validate(file, kind);
      return {
        id: crypto.randomUUID(), file, kind, status: error ? "invalid" : "preparing", error: error ?? undefined,
        loaded: 0, total: file.size, addedAt: Date.now(), target: targetRef.current,
        preview: !error && kind === "image" ? URL.createObjectURL(file) : undefined,
      };
    });
    setItems((l) => [...next, ...l]);
    setTrayOpen(true);
    for (const it of next) {
      if (it.status !== "preparing") continue;
      if (it.kind === "video") {
        const url = URL.createObjectURL(it.file);
        inspectVideo(it.file, url).then((r) => {
          URL.revokeObjectURL(url);
          const poster = r.poster ? URL.createObjectURL(r.poster) : undefined;
          setItems((list) => list.map((cur) => {
            if (cur.id !== it.id) return cur;
            // Canceled or removed while inspecting — don't resurrect it.
            if (cur.status !== "preparing") { if (poster) URL.revokeObjectURL(poster); return cur; }
            return {
              ...cur,
              status: "queued",
              meta: { width: r.width, height: r.height, duration: r.duration },
              poster: r.poster,
              preview: poster,
              note: r.playable ? undefined : "This browser can't preview this video. It will still be uploaded.",
            };
          }));
        });
      } else {
        patch(it.id, { status: "queued" });
      }
    }
  }, [validate, patch]);

  const start = useCallback((item: UploadItem) => {
    if (limits.directBlobUpload) {
      if (aborters.current.has(item.id)) return;
      const controller = new AbortController();
      aborters.current.set(item.id, controller);
      patch(item.id, { status: "uploading", loaded: 0, error: undefined });
      const ext = extOf(item.file.name) || (item.kind === "video" ? "mp4" : "jpg");
      const pathname = `media/${item.id}/original.${ext}`;
      void (async () => {
        try {
          const blob = await upload(pathname, item.file, {
            access: "private",
            handleUploadUrl: "/api/media/blob-upload",
            headers: CSRF_HEADERS,
            contentType: item.file.type || "application/octet-stream",
            multipart: item.file.size > 100 * 1024 * 1024,
            abortSignal: controller.signal,
            onUploadProgress: (e) => patch(item.id, { loaded: e.loaded, total: e.total }),
          });
          patch(item.id, { status: "processing", loaded: item.file.size });
          const res = await fetch("/api/media/blob-finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...CSRF_HEADERS },
            body: JSON.stringify({
              id: item.id, pathname: blob.pathname, name: item.file.name,
              folderId: item.target.folderId, ...item.meta,
            }),
          });
          const body = await res.json().catch(() => ({})) as { media?: Media; folderMissing?: boolean; error?: string };
          if (!res.ok || !body.media) throw new Error(body.error ?? `The server couldn't save this file (${res.status}).`);
          let media = body.media;
          let note = body.folderMissing ? `“${item.target.label}” no longer exists, so this file was saved to All media.` : item.note;
          if (media.kind === "video" && item.poster) {
            patch(item.id, { status: "finalizing", media });
            invalidateMedia();
            try {
              const posterRes = await fetch(`/api/media/${media.id}/poster`, {
                method: "PUT", body: item.poster, headers: { "Content-Type": "image/jpeg", ...CSRF_HEADERS },
              });
              if (posterRes.ok) media = (await posterRes.json()).media;
              else note = "Uploaded without a preview frame.";
            } catch { note = "Uploaded without a preview frame."; }
          }
          patch(item.id, { status: "done", media, note });
          invalidateMedia();
        } catch (error) {
          if (controller.signal.aborted) patch(item.id, { status: "canceled", error: undefined });
          else patch(item.id, { status: "failed", error: error instanceof Error ? error.message : "The upload failed." });
        } finally {
          aborters.current.delete(item.id);
        }
      })();
      return;
    }
    if (xhrs.current.has(item.id)) return;
    const xhr = new XMLHttpRequest();
    xhrs.current.set(item.id, xhr);
    patch(item.id, { status: "uploading", loaded: 0, error: undefined });
    xhr.open("POST", "/api/media/upload");
    xhr.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(item.file.name));
    xhr.setRequestHeader("X-Nexo-Request", CSRF_HEADERS["X-Nexo-Request"]);
    if (item.target.folderId) xhr.setRequestHeader("X-Folder-Id", item.target.folderId);
    if (item.meta?.width) xhr.setRequestHeader("X-Media-Width", String(item.meta.width));
    if (item.meta?.height) xhr.setRequestHeader("X-Media-Height", String(item.meta.height));
    if (item.meta?.duration) xhr.setRequestHeader("X-Media-Duration", String(item.meta.duration));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) patch(item.id, { loaded: e.loaded, total: e.total });
    };
    // All bytes are sent: the server is now validating, generating previews and saving.
    xhr.upload.onload = () => patch(item.id, { status: "processing", loaded: item.file.size });
    xhr.onload = async () => {
      xhrs.current.delete(item.id);
      let body: { media?: Media; folderMissing?: boolean; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 201 && body.media) {
        let media = body.media;
        let note = body.folderMissing ? `“${item.target.label}” no longer exists, so this file was saved to All media.` : item.note;
        if (media.kind === "video" && item.poster) {
          // The file is saved: show it in the gallery now, marked as still creating its preview.
          patch(item.id, { status: "finalizing", media });
          invalidateMedia();
          try {
            const r = await fetch(`/api/media/${media.id}/poster`, { method: "PUT", body: item.poster, headers: { "Content-Type": "image/jpeg", ...CSRF_HEADERS } });
            if (r.ok) media = (await r.json()).media;
            else note = "Uploaded without a preview frame.";
          } catch {
            note = "Uploaded without a preview frame.";
          }
        }
        patch(item.id, { status: "done", media, note });
        invalidateMedia();
      } else if (xhr.status === 401) {
        patch(item.id, { status: "failed", error: "The workspace was locked. Unlock it again, then retry this file." });
      } else {
        patch(item.id, { status: "failed", error: body.error ?? `The server couldn't save this file (${xhr.status || "no response"}).` });
      }
    };
    xhr.onerror = () => {
      xhrs.current.delete(item.id);
      patch(item.id, { status: "failed", error: "The connection was lost during upload. Check your network and retry." });
    };
    xhr.onabort = () => {
      xhrs.current.delete(item.id);
      patch(item.id, { status: "canceled", error: undefined });
    };
    xhr.send(item.file);
  }, [limits.directBlobUpload, patch]);

  // Scheduler: keep up to CONCURRENCY uploads running.
  useEffect(() => {
    const running = items.filter((i) => i.status === "uploading" || i.status === "processing").length;
    const waiting = items.filter((i) => i.status === "queued").sort((a, b) => a.addedAt - b.addedAt);
    for (const it of waiting.slice(0, Math.max(0, CONCURRENCY - running))) start(it);
  }, [items, start]);

  const cancel = useCallback((id: string) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (!it) return;
    if (it.status === "uploading") {
      xhrs.current.get(id)?.abort();
      aborters.current.get(id)?.abort();
    }
    else if (it.status === "queued" || it.status === "preparing") patch(id, { status: "canceled" });
  }, [patch]);

  const retry = useCallback((id: string) => {
    const it = itemsRef.current.find((i) => i.id === id);
    if (it && (it.status === "failed" || it.status === "canceled")) patch(id, { status: "queued", loaded: 0, error: undefined, addedAt: Date.now() });
  }, [patch]);

  const release = (it: UploadItem) => { if (it.preview) URL.revokeObjectURL(it.preview); };

  const remove = useCallback((id: string) => {
    setItems((l) => {
      const it = l.find((i) => i.id === id);
      if (!it || it.status === "uploading" || it.status === "processing" || it.status === "finalizing") return l;
      release(it);
      return l.filter((i) => i.id !== id);
    });
  }, []);

  const clearFinished = useCallback(() => {
    setItems((l) => {
      const keep = l.filter((i) => ACTIVE_STATUSES.includes(i.status));
      l.filter((i) => !keep.includes(i)).forEach(release);
      return keep;
    });
  }, []);

  // Release every object URL on unmount.
  useEffect(() => () => itemsRef.current.forEach(release), []);

  // Warn before leaving while bytes are in flight.
  const activeCount = items.filter((i) => ACTIVE_STATUSES.includes(i.status)).length;
  const previewPending = useMemo(
    () => new Set(items.filter((i) => i.status === "finalizing" && i.media).map((i) => i.media!.id)),
    [items],
  );
  useEffect(() => {
    if (!activeCount) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [activeCount]);

  // Global drag-and-drop target.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  // Completed rows leave the tray on their own; failures stay until retried or dismissed.
  const scheduled = useRef(new Set<string>());
  useEffect(() => {
    for (const it of items) {
      if (it.status !== "done" || scheduled.current.has(it.id)) continue;
      scheduled.current.add(it.id);
      setTimeout(() => { scheduled.current.delete(it.id); remove(it.id); }, 6000);
    }
  }, [items, remove]);

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const value = useMemo(() => ({ items, addFiles, openPicker, cancel, retry, remove, clearFinished, trayOpen, setTrayOpen, activeCount, dragging, target, setTarget, previewPending }),
    [items, addFiles, openPicker, cancel, retry, remove, clearFinished, trayOpen, activeCount, dragging, target, setTarget, previewPending]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
      />
      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-pill">
            <UploadCloud />
            <span><b>Release to upload to {target.label}</b> · {UPLOAD_RULES.image.label} · {UPLOAD_RULES.video.label}</span>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useUploads() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUploads must be used inside UploadProvider");
  return v;
}
