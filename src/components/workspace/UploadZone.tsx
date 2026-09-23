"use client";

import { useState } from "react";
import { FolderOpen, ImageIcon, Play, UploadCloud } from "lucide-react";
import { useUploads } from "@/components/providers/UploadProvider";
import { formatBytes } from "@/lib/format";
import { UPLOAD_RULES } from "@/lib/types";

export type ZoneSize = "hero" | "standard" | "compact";

/**
 * The upload panel. "hero" for an empty workspace, "standard" for a small library and
 * "compact" once the library is large, so media stays above the fold. Dropped files are
 * received by UploadProvider's window-level handler; this panel only reflects the drag state.
 */
export function UploadZone({ size, limits, folderName }: { size: ZoneSize; limits: { maxImageBytes: number; maxVideoBytes: number }; folderName?: string }) {
  const { openPicker, dragging } = useUploads();
  const [over, setOver] = useState(false);
  const active = dragging || over;

  return (
    <section
      className={`zone zone-${size}`}
      data-active={active || undefined}
      aria-labelledby="zone-title"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
    >
      <span className="zone-icon" aria-hidden><UploadCloud /></span>
      <div className="zone-text">
        <h2 id="zone-title" className="zone-title" aria-live="polite">
          {active
            ? folderName ? `Release to upload to “${folderName}”.` : "Release to upload."
            : folderName ? `Drop files here to add them to “${folderName}”.` : "Drop it here. Keep it together."}
        </h2>
        <p className="zone-sub">
          <span className="hover-only">{folderName ? "Uploads go straight into this folder." : "Upload images and videos to your private media space."}</span>
          <span className="touch-only">Add photos and videos from your device to your private media space.</span>
        </p>
        <p className="zone-rules">
          <span>Images · {UPLOAD_RULES.image.label} · up to {formatBytes(limits.maxImageBytes, 0)}</span>
          <span>Videos · {UPLOAD_RULES.video.label} · up to {formatBytes(limits.maxVideoBytes, 0)}</span>
        </p>
      </div>
      {/* Purely illustrative outline tiles — not media. */}
      <span className="zone-art" aria-hidden>
        <span className="zone-tile t1"><ImageIcon /></span>
        <span className="zone-tile t2"><Play /></span>
        <span className="zone-tile t3"><ImageIcon /></span>
      </span>
      <button className={`btn ${size === "compact" ? "" : "btn-primary"} zone-browse`} onClick={openPicker}>
        <FolderOpen aria-hidden /> Browse files
      </button>
    </section>
  );
}
