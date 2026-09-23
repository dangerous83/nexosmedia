"use client";

import { AlertCircle, Ban, CheckCircle2, Clock, Film, ImageIcon, Loader2, RotateCw, X } from "lucide-react";
import { ACTIVE_STATUSES, useUploads, type UploadItem } from "@/components/providers/UploadProvider";
import { formatBytes } from "@/lib/format";

const STATUS: Record<UploadItem["status"], { label: string; icon: typeof Clock; tone: string }> = {
  preparing: { label: "Reading file…", icon: Loader2, tone: "muted" },
  queued: { label: "Waiting to upload", icon: Clock, tone: "muted" },
  uploading: { label: "Uploading", icon: Loader2, tone: "accent" },
  processing: { label: "Transfer complete · saving and creating thumbnail…", icon: Loader2, tone: "accent" },
  finalizing: { label: "Saved · creating video preview…", icon: Loader2, tone: "accent" },
  done: { label: "Uploaded", icon: CheckCircle2, tone: "success" },
  failed: { label: "Failed", icon: AlertCircle, tone: "danger" },
  canceled: { label: "Canceled", icon: Ban, tone: "muted" },
  invalid: { label: "Not supported", icon: AlertCircle, tone: "danger" },
};

export function UploadRow({ item }: { item: UploadItem }) {
  const { cancel, retry, remove } = useUploads();
  const s = STATUS[item.status];
  const pct = item.total ? Math.round((item.loaded / item.total) * 100) : 0;
  const Icon = s.icon;
  const busy = item.status === "uploading" || item.status === "processing" || item.status === "preparing" || item.status === "finalizing";
  const KindIcon = item.kind === "video" ? Film : ImageIcon;

  return (
    <li className={`uq-row uq-${s.tone}`}>
      <div className="uq-thumb">
        {item.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.preview} alt="" />
        ) : (
          <KindIcon aria-hidden />
        )}
        {item.status !== "done" && item.preview && <span className="uq-local" title="Preview from your device — not saved yet">Local</span>}
      </div>
      <div className="uq-main">
        <p className="uq-name truncate" title={item.file.name}>{item.file.name}</p>
        {item.target.folderId && <p className="uq-dest truncate">To {item.target.label}</p>}
        <p className="uq-status">
          <Icon aria-hidden className={busy ? "spin" : undefined} />
          <span>
            {s.label}
            {item.status === "uploading" && <span className="tabular"> · {pct}% of {formatBytes(item.total)}</span>}
            {(item.status === "queued" || item.status === "done" || item.status === "canceled") && <span className="tabular"> · {formatBytes(item.file.size)}</span>}
          </span>
        </p>
        {(item.status === "uploading" || item.status === "processing") && (
          <div
            className={`progress${item.status === "processing" ? " is-indeterminate" : ""}`}
            role="progressbar"
            aria-label={`Upload progress for ${item.file.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.status === "processing" ? undefined : pct}
          >
            <span style={{ width: `${item.status === "processing" ? 100 : pct}%` }} />
          </div>
        )}
        {item.error && <p className="uq-error">{item.error}</p>}
        {item.note && !item.error && <p className="uq-note">{item.note}</p>}
      </div>
      <div className="uq-actions">
        {(item.status === "failed" || item.status === "canceled") && (
          <button className="icon-btn icon-btn-sm" onClick={() => retry(item.id)} aria-label={`Retry ${item.file.name}`}><RotateCw /></button>
        )}
        {(item.status === "uploading" || item.status === "queued" || item.status === "preparing") && (
          <button className="icon-btn icon-btn-sm" onClick={() => cancel(item.id)} aria-label={`Cancel upload of ${item.file.name}`}><X /></button>
        )}
        {(item.status === "processing" || item.status === "finalizing") && (
          <span className="icon-btn icon-btn-sm" aria-hidden title="Almost done — can't be canceled while the server saves it"><Loader2 className="spin" /></span>
        )}
        {!busy && item.status !== "queued" && (
          <button className="icon-btn icon-btn-sm" onClick={() => remove(item.id)} aria-label={`Remove ${item.file.name} from list`}><X /></button>
        )}
      </div>
    </li>
  );
}

export function UploadQueueList({ items }: { items: UploadItem[] }) {
  return <ul className="uq-list" aria-label="Upload queue">{items.map((i) => <UploadRow key={i.id} item={i} />)}</ul>;
}

export function queueSummary(items: UploadItem[]) {
  const active = items.filter((i) => ACTIVE_STATUSES.includes(i.status));
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed" || i.status === "invalid").length;
  const totalBytes = active.reduce((a, i) => a + i.total, 0);
  const sentBytes = active.reduce((a, i) => a + (i.status === "processing" || i.status === "finalizing" ? i.total : i.status === "uploading" ? i.loaded : 0), 0);
  return { active: active.length, done, failed, pct: totalBytes ? Math.round((sentBytes / totalBytes) * 100) : 100 };
}
