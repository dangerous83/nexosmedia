"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ChevronDown, Film, Folder as FolderIcon, FolderPlus, Images, LayoutGrid, Lock, PanelLeftClose, PanelLeftOpen,
  ShieldCheck, Trash2, Upload, UploadCloud,
} from "lucide-react";
import { BrandSymbol, Wordmark } from "@/components/Brand";
import { useUploads } from "@/components/providers/UploadProvider";
import { useDialogs } from "@/components/providers/DialogsProvider";
import { useQuery } from "@/lib/store";
import { hrefFor, parseLoc, sameLoc, type Loc } from "@/lib/location";
import { useLock } from "./useLock";
import type { Folder, Summary } from "@/lib/types";

interface Props { rail?: boolean; onNavigate?: () => void; onToggleRail?: () => void; canToggle?: boolean }

export function Sidebar({ rail = false, onNavigate, onToggleRail, canToggle }: Props) {
  const loc = parseLoc(useSearchParams());
  const { openPicker, activeCount, items } = useUploads();
  const { newFolder } = useDialogs();
  const { data: summary } = useQuery<Summary>("/api/summary");
  const { data: fdata } = useQuery<{ folders: Folder[] }>("/api/folders");
  const [foldersOpen, setFoldersOpen] = useState(true);
  const lock = useLock();
  const folders = fdata?.folders ?? [];
  const failures = items.filter((i) => i.status === "failed" || i.status === "invalid").length;

  const link = (to: Loc, label: string, Icon: typeof Images, count?: number | null, badge?: React.ReactNode) => {
    const active = sameLoc(loc, to);
    return (
      <Link
        href={hrefFor(to)}
        className="nav-item"
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        data-tip={rail ? label : undefined}
        aria-label={rail ? `${label}${count ? `, ${count}` : ""}` : undefined}
      >
        <Icon aria-hidden />
        <span className="nav-label">{label}</span>
        {badge ?? (count != null && count > 0 ? <span className="nav-count tabular" aria-label={`${count} items`}>{count.toLocaleString()}</span> : null)}
      </Link>
    );
  };

  return (
    <div className={`side${rail ? " is-rail" : ""}`}>
      <div className="side-top">
        <Link href="/" className="side-brand" onClick={onNavigate} aria-label="NEXOSPHERE Media Space home">
          <BrandSymbol size={30} priority />
          <span className="side-brand-text">
            <Wordmark height={10} />
            <span className="side-brand-tag">Media Space</span>
          </span>
        </Link>
        <button className="btn btn-primary side-upload" onClick={() => { openPicker(); onNavigate?.(); }} data-tip={rail ? "Upload files" : undefined} aria-label={rail ? "Upload files" : undefined}>
          <Upload aria-hidden /><span className="nav-label">Upload files</span>
        </button>
      </div>

      <nav className="side-nav" aria-label="Workspace">
        <p className="nav-section">Library</p>
        <ul>
          <li>{link({ kind: "all" }, "All media", LayoutGrid, summary?.all)}</li>
          <li>{link({ kind: "images" }, "Images", Images, summary?.images)}</li>
          <li>{link({ kind: "videos" }, "Videos", Film, summary?.videos)}</li>
        </ul>

        <div className="nav-section nav-section-row">
          {rail ? <span className="sr-only">Folders</span> : (
            <button className="nav-section-toggle" onClick={() => setFoldersOpen(!foldersOpen)} aria-expanded={foldersOpen} aria-controls="side-folders">
              <ChevronDown aria-hidden className={foldersOpen ? "" : "is-closed"} /> Folders
            </button>
          )}
          {!rail && (
            <button className="icon-btn icon-btn-xs" onClick={() => { newFolder(); onNavigate?.(); }} aria-label="Create folder" title="Create folder"><FolderPlus /></button>
          )}
        </div>
        <ul id="side-folders">
          <li>{link({ kind: "folders" }, rail ? "Folders" : "All folders", FolderIcon, folders.length || null)}</li>
          {!rail && foldersOpen && folders.map((f) => (
            <li key={f.id}>
              <Link href={hrefFor({ kind: "folder", id: f.id })} className="nav-item nav-folder" aria-current={loc.kind === "folder" && loc.id === f.id ? "page" : undefined} onClick={onNavigate}>
                <span className="nav-dot" aria-hidden />
                <span className="nav-label" title={f.name}>{f.name}</span>
                {f.count > 0 && <span className="nav-count tabular">{f.count}</span>}
              </Link>
            </li>
          ))}
          {rail && <li><button className="nav-item" onClick={() => newFolder()} data-tip="Create folder" aria-label="Create folder"><FolderPlus aria-hidden /></button></li>}
        </ul>

        <p className="nav-section">Workspace</p>
        <ul>
          <li>{link({ kind: "uploads" }, "Uploads", UploadCloud, null,
            activeCount > 0
              ? <span className="nav-live" aria-label={`${activeCount} uploading`}><span className="spinner" />{activeCount}</span>
              : failures > 0 ? <span className="nav-warn" aria-label={`${failures} need attention`}>{failures}</span> : undefined)}</li>
          <li>{link({ kind: "trash" }, "Trash", Trash2, summary?.trash)}</li>
        </ul>
      </nav>

      <div className="side-foot">
        <p className="side-status" data-tip={rail ? "Private workspace — passphrase protected" : undefined}>
          <ShieldCheck aria-hidden />
          <span className="nav-label">Private workspace<span className="side-status-sub">Shared by passphrase</span></span>
        </p>
        <button className="nav-item" onClick={lock} data-tip={rail ? "Lock workspace" : undefined} aria-label={rail ? "Lock workspace" : undefined}>
          <Lock aria-hidden /><span className="nav-label">Lock workspace</span>
        </button>
        {canToggle && (
          <button className="nav-item side-collapse" onClick={onToggleRail} aria-label={rail ? "Expand sidebar" : "Collapse sidebar"} data-tip={rail ? "Expand sidebar" : undefined}>
            {rail ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            <span className="nav-label">Collapse sidebar</span>
          </button>
        )}
      </div>
    </div>
  );
}
