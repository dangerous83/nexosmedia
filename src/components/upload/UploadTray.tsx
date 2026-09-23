"use client";

import { ChevronDown, ChevronUp, UploadCloud, X } from "lucide-react";
import { useUploads } from "@/components/providers/UploadProvider";
import { UploadQueueList, queueSummary } from "./UploadQueue";

/** Floating upload panel (bottom-right), available on every page. */
export function UploadTray() {
  const { items, trayOpen, setTrayOpen, clearFinished } = useUploads();
  if (!items.length) return null;
  const s = queueSummary(items);
  const title = s.active
    ? `Uploading ${s.active} file${s.active > 1 ? "s" : ""}`
    : s.failed
      ? `${s.failed} file${s.failed > 1 ? "s" : ""} need${s.failed > 1 ? "" : "s"} attention`
      : `${s.done} upload${s.done === 1 ? "" : "s"} complete`;

  return (
    <section className="tray" data-open={trayOpen || undefined} aria-label="Uploads">
      <header className="tray-head">
        <button className="tray-toggle" onClick={() => setTrayOpen(!trayOpen)} aria-expanded={trayOpen}>
          <span className="tray-icon" aria-hidden><UploadCloud /></span>
          <span className="tray-title">
            <span className="truncate">{title}</span>
            {s.active > 0 && <span className="subtle tabular" style={{ fontSize: "var(--text-xs)" }}>{s.pct}% sent</span>}
          </span>
          {trayOpen ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
        </button>
        {!s.active && (
          <button className="icon-btn icon-btn-sm" onClick={clearFinished} aria-label="Dismiss finished uploads"><X /></button>
        )}
      </header>
      {s.active > 0 && (
        <div className="progress tray-progress" aria-hidden><span style={{ width: `${s.pct}%` }} /></div>
      )}
      {trayOpen && (
        <div className="tray-body">
          <UploadQueueList items={items} />
        </div>
      )}
    </section>
  );
}
