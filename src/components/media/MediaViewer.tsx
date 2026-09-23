"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Info, Maximize, Minus, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { ItemActions } from "./MediaItem";
import { useReturnFocus } from "@/lib/focus";
import { mediaUrl } from "@/lib/api";
import { dimensions, formatBytes, formatDate, formatDuration, mediaFormat } from "@/lib/format";
import type { Media } from "@/lib/types";

interface ViewerProps {
  items: Media[];
  index: number | null;
  onIndexChange: (i: number | null) => void;
  actions: Pick<ItemActions, "details" | "trash" | "restore" | "purge">;
  total: number;
}

export function MediaViewer({ items, index, onIndexChange, actions, total }: ViewerProps) {
  const open = index != null && !!items[index];
  const media = open ? items[index!] : null;
  const lastId = useRef<string | null>(null);
  if (media) lastId.current = media.id;
  // Return focus to the card of the last item shown (it may differ from the one that was opened).
  const returnFocus = useReturnFocus(useCallback(
    () => (lastId.current ? document.querySelector<HTMLElement>(`[data-mid="${lastId.current}"]`) : null), [],
  ));
  const prev = useCallback(() => { if (index != null && index > 0) onIndexChange(index - 1); }, [index, onIndexChange]);
  const next = useCallback(() => { if (index != null && index < items.length - 1) onIndexChange(index + 1); }, [index, items.length, onIndexChange]);

  // Keep the index valid when the list changes underneath (e.g. after a delete).
  useEffect(() => {
    if (index == null) return;
    if (items.length === 0) onIndexChange(null);
    else if (index > items.length - 1) onIndexChange(items.length - 1);
  }, [items.length, index, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, video")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next]);

  // Warm up neighbouring thumbnails for quick navigation.
  useEffect(() => {
    if (index == null) return;
    for (const m of [items[index - 1], items[index + 1]]) if (m?.hasThumb) new Image().src = mediaUrl.thumb(m);
  }, [index, items]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="viewer-overlay" />
        <Dialog.Content
          className="viewer"
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).querySelector<HTMLElement>(".viewer-close")?.focus(); }}
        >
          {media && (
            <>
              <div className="viewer-stage-wrap">
                <header className="viewer-bar">
                  <Dialog.Close asChild>
                    <button className="icon-btn viewer-close" aria-label="Close preview (Esc)"><X /></button>
                  </Dialog.Close>
                  <Dialog.Title className="viewer-bar-title truncate">{media.name}</Dialog.Title>
                  <span className="viewer-count tabular" aria-live="polite">{index! + 1} / {total}</span>
                </header>
                <Stage key={media.id} media={media} />
                <button className="viewer-nav viewer-prev" onClick={prev} disabled={index === 0} aria-label="Previous (Left arrow)"><ChevronLeft /></button>
                <button className="viewer-nav viewer-next" onClick={next} disabled={index === items.length - 1} aria-label="Next (Right arrow)"><ChevronRight /></button>
              </div>
              <aside className="viewer-panel" aria-label="File details">
                <div className="viewer-actions">
                  <a className="btn btn-primary" href={mediaUrl.download(media)} download><Download aria-hidden /> Download original</a>
                  {media.trashedAt != null ? (
                    <>
                      <button className="btn" onClick={() => actions.restore(media)}><RotateCcw aria-hidden /> Restore</button>
                      <button className="btn btn-danger-ghost" onClick={() => actions.purge(media)}><Trash2 aria-hidden /> Delete permanently</button>
                    </>
                  ) : (
                    <>
                      <button className="btn" onClick={() => { onIndexChange(null); actions.details(media); }}><Info aria-hidden /> Details &amp; actions</button>
                      <button className="btn btn-danger-ghost" onClick={() => actions.trash(media)}><Trash2 aria-hidden /> Move to Trash</button>
                    </>
                  )}
                </div>
                <section className="viewer-section">
                  <h3 className="eyebrow">Details</h3>
                  <dl className="viewer-dl">
                    <div><dt>File name</dt><dd className="viewer-filename">{media.name}</dd></div>
                    <div><dt>Type</dt><dd>{media.kind === "video" ? "Video" : "Image"} · {mediaFormat(media)}</dd></div>
                    {dimensions(media) && <div><dt>Dimensions</dt><dd className="tabular">{dimensions(media)} px</dd></div>}
                    {media.kind === "video" && <div><dt>Duration</dt><dd className="tabular">{formatDuration(media.duration) || "Unknown"}</dd></div>}
                    <div><dt>Size</dt><dd className="tabular">{formatBytes(media.size, 2)}</dd></div>
                    <div><dt>Uploaded</dt><dd className="tabular">{formatDate(media.createdAt)}</dd></div>
                  </dl>
                </section>
              </aside>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Stage({ media }: { media: Media }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Stop playback when the preview closes or moves to another item.
  useEffect(() => {
    const v = videoRef.current;
    return () => { v?.pause(); };
  }, []);

  const zoom = useCallback((to: number) => {
    const s = Math.min(6, Math.max(1, Math.round(to * 100) / 100));
    setScale(s);
    if (s === 1) setPos({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (media.kind !== "image") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "+" || e.key === "=") zoom(scale * 1.25);
      if (e.key === "-") zoom(scale / 1.25);
      if (e.key === "0") zoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [media.kind, scale, zoom]);

  if (failed) {
    return (
      <div className="viewer-stage">
        <div className="viewer-error" role="alert">
          <AlertTriangle aria-hidden />
          <p className="viewer-error-title">{media.kind === "video" ? "This video can't be played in this browser" : "This image couldn't be loaded"}</p>
          <p className="muted">
            {media.kind === "video"
              ? "Its codec may not be supported here (for example HEVC/H.265 in some browsers). The original file is intact — download it to play it in another app."
              : "The file may be unavailable in storage. Try again later, or download the original."}
          </p>
          <a className="btn" href={mediaUrl.download(media)} download><Download aria-hidden /> Download original</a>
        </div>
      </div>
    );
  }

  if (media.kind === "video") {
    return (
      <div className="viewer-stage">
        <video
          ref={videoRef}
          className="viewer-video"
          src={mediaUrl.file(media)}
          poster={media.hasThumb ? mediaUrl.thumb(media) : undefined}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          aria-label={`Video: ${media.name}`}
        />
      </div>
    );
  }

  return (
    <div
      className="viewer-stage"
      data-zoomed={scale > 1 || undefined}
      onWheel={(e) => zoom(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))}
      onPointerDown={(e) => { if (scale > 1 && !(e.target as HTMLElement).closest("button")) { drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } }}
      onPointerMove={(e) => { if (drag.current) setPos({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) }); }}
      onPointerUp={() => { drag.current = null; }}
      onDoubleClick={() => zoom(scale > 1 ? 1 : 2)}
    >
      {!loaded && media.hasThumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="viewer-img viewer-img-placeholder" src={mediaUrl.thumb(media)} alt="" aria-hidden />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="viewer-img"
        src={mediaUrl.file(media)}
        alt={media.name}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, opacity: loaded ? 1 : 0 }}
      />
      <div className="viewer-zoom" role="group" aria-label="Zoom">
        <button className="icon-btn icon-btn-sm" onClick={() => zoom(scale / 1.25)} disabled={scale <= 1} aria-label="Zoom out (−)"><Minus /></button>
        <button className="viewer-zoom-level tabular" onClick={() => zoom(1)} aria-label={`Current zoom ${Math.round(scale * 100)}%. Reset zoom (0)`}>{Math.round(scale * 100)}%</button>
        <button className="icon-btn icon-btn-sm" onClick={() => zoom(scale * 1.25)} disabled={scale >= 6} aria-label="Zoom in (+)"><Plus /></button>
        <button className="icon-btn icon-btn-sm" onClick={() => zoom(1)} disabled={scale === 1} aria-label="Fit to screen"><Maximize /></button>
      </div>
    </div>
  );
}
