"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  AlertCircle, CheckSquare, ChevronRight, Download, Folder as FolderIcon, FolderInput, FolderPlus, Grid2x2, Grid3x3, LayoutGrid, List, Square,
  Menu as MenuIcon, MoreHorizontal, Pencil, RotateCcw, RotateCw, Search, SearchX, Trash2, Upload, X,
} from "lucide-react";
import { BrandSymbol } from "@/components/Brand";
import { useOpenDrawer } from "@/components/shell/AppShell";
import { useUploads, ACTIVE_STATUSES } from "@/components/providers/UploadProvider";
import { useDialogs } from "@/components/providers/DialogsProvider";
import { useConfirm } from "@/components/providers/ConfirmProvider";
import { useToast } from "@/components/providers/ToastProvider";
import { MediaCard, MediaRow, type ItemActions } from "@/components/media/MediaItem";
import { MediaThumb } from "@/components/media/MediaThumb";
import { MediaViewer } from "@/components/media/MediaViewer";
import { DetailsPanel } from "@/components/media/DetailsPanel";
import { useMediaActions } from "@/components/media/useMediaActions";
import { UploadQueueList } from "@/components/upload/UploadQueue";
import { UploadZone, type ZoneSize } from "./UploadZone";
import { api } from "@/lib/api";
import { invalidateMedia, useMediaList, usePrefs, useQuery, type Density } from "@/lib/store";
import { hrefFor, mediaScope, parseLoc, type Loc } from "@/lib/location";
import { plural } from "@/lib/format";
import type { Folder, Media, SortKey, Summary } from "@/lib/types";

type Limits = { maxImageBytes: number; maxVideoBytes: number };

const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "name", label: "File name (A–Z)" },
  { key: "size", label: "File size (largest)" },
];
const DENSITIES: { key: Density; label: string; icon: typeof Square }[] = [
  { key: "compact", label: "Compact", icon: Grid3x3 }, { key: "comfortable", label: "Comfortable", icon: Grid2x2 }, { key: "large", label: "Large", icon: Square },
];

function titleFor(loc: Loc, folder: Folder | null | undefined) {
  switch (loc.kind) {
    case "all": return "All media";
    case "images": return "Images";
    case "videos": return "Videos";
    case "folders": return "Folders";
    case "folder": return folder?.name ?? "Folder";
    case "trash": return "Trash";
    case "uploads": return "Uploads";
  }
}

export function Workspace({ limits }: { limits: Limits }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const loc = parseLoc(params);
  const q = params.get("q") ?? "";
  const sortParam = params.get("sort");
  const sort: SortKey = SORTS.some((s) => s.key === sortParam) ? (sortParam as SortKey) : "newest";
  const { data: fdata } = useQuery<{ folders: Folder[] }>("/api/folders");
  const { data: summary } = useQuery<Summary>("/api/summary");
  const folders = useMemo(() => fdata?.folders ?? [], [fdata]);
  const folder = loc.kind === "folder" ? folders.find((f) => f.id === loc.id) ?? null : null;
  const { setTarget } = useUploads();

  // Uploads go into the open folder; everywhere else they land unfiled in All media.
  useEffect(() => {
    setTarget(folder ? { folderId: folder.id, label: folder.name } : { folderId: null, label: "All media" });
  }, [folder, setTarget]);

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  }, [params, pathname, router]);

  const title = titleFor(loc, folder);
  const key = loc.kind === "folder" ? `folder-${loc.id}` : loc.kind;

  return (
    <>
      <UtilityHeader loc={loc} title={title} folder={folder} q={q} setParam={setParam} summary={summary} />
      {loc.kind === "folders" ? (
        <FoldersView key={key} folders={folders} loaded={!!fdata} q={q} />
      ) : loc.kind === "uploads" ? (
        <UploadsView key={key} limits={limits} />
      ) : loc.kind === "folder" && fdata && !folder ? (
        <main id="main" className="ws-main ws-pad" tabIndex={-1}>
          <div className="state" role="alert">
            <span className="state-icon"><FolderIcon /></span>
            <h1 className="state-title">This folder doesn&rsquo;t exist anymore</h1>
            <p>It may have been deleted. Its files were moved back to All media.</p>
            <Link className="btn" href="/?view=folders">Go to folders</Link>
          </div>
        </main>
      ) : (
        <MediaView key={key} loc={loc} title={title} folder={folder} folders={folders} q={q} sort={sort} setParam={setParam} summary={summary} limits={limits} />
      )}
    </>
  );
}

// ——— Utility header ———

function UtilityHeader({ loc, title, folder, q, setParam, summary }: {
  loc: Loc; title: string; folder: Folder | null; q: string; setParam: (p: Record<string, string | null>) => void; summary?: Summary;
}) {
  const openDrawer = useOpenDrawer();
  const { openPicker, target } = useUploads();
  const dialogs = useDialogs();
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const { purge } = useMediaActions();
  const [draft, setDraft] = useState(q);
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) { setLastQ(q); setDraft(q); }
  useEffect(() => {
    if (draft.trim() === q) return;
    const t = setTimeout(() => setParam({ q: draft.trim() || null }), 250);
    return () => clearTimeout(t);
  }, [draft, q, setParam]);

  const deleteFolder = async (f: Folder) => {
    const ok = await confirm({
      tone: "danger",
      title: `Delete the folder “${f.name}”?`,
      description: (
        <>
          {f.count ? `Its ${plural(f.count, "file")} will move back to All media as unfiled files.` : "The folder is empty."} No files are deleted or moved to Trash. This applies to everyone with access.
        </>
      ),
      confirmLabel: "Delete folder",
    });
    if (!ok) return;
    try {
      const r = await api<{ unfiled: number }>(`/api/folders/${f.id}`, { method: "DELETE" });
      invalidateMedia();
      toast({ title: "Folder deleted", description: r.unfiled ? `${plural(r.unfiled, "file")} moved back to All media.` : undefined });
      router.push("/?view=folders");
    } catch (e) {
      toast({ tone: "error", title: "Couldn't delete the folder", description: (e as Error).message });
    }
  };

  const searchable = loc.kind !== "uploads";
  const scopeLabel = loc.kind === "folders" ? "folders" : loc.kind === "all" ? "all media" : loc.kind === "folder" ? "this folder" : title.toLowerCase();

  return (
    <header className="uhead">
      <div className="uhead-row">
        <button className="icon-btn uhead-menu" onClick={openDrawer} aria-label="Open navigation"><MenuIcon /></button>
        <Link href="/" className="uhead-logo" aria-label="NEXOSPHERE Media Space — All media"><BrandSymbol size={28} /></Link>
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            <li className="crumb-root"><Link href="/">Media Space</Link></li>
            {loc.kind === "folder" && <li><ChevronRight aria-hidden /><Link href="/?view=folders">Folders</Link></li>}
            <li><ChevronRight aria-hidden /><span aria-current="page" className="crumb-current">{title}</span></li>
          </ol>
        </nav>
        {searchable && (
          <div className="search-field uhead-search">
            <Search aria-hidden />
            <input
              className="input"
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Search ${scopeLabel}`}
              aria-label={`Search ${scopeLabel} by file name`}
              enterKeyHint="search"
            />
            {draft && <button className="icon-btn icon-btn-sm clear" onClick={() => { setDraft(""); setParam({ q: null }); }} aria-label="Clear search"><X /></button>}
          </div>
        )}
        <div className="uhead-actions">
          {loc.kind === "folders" && <button className="btn" onClick={() => dialogs.newFolder()}><FolderPlus aria-hidden /><span className="hide-sm">New folder</span></button>}
          {loc.kind === "trash" && !!summary?.trash && <button className="btn btn-danger-ghost" onClick={() => purge("all")}><Trash2 aria-hidden /><span className="hide-sm">Empty Trash</span></button>}
          {folder && (
            <Menu.Root modal={false}>
              <Menu.Trigger asChild><button className="btn" aria-label={`Folder actions for ${folder.name}`}><MoreHorizontal aria-hidden /><span className="hide-sm">Folder</span></button></Menu.Trigger>
              <Menu.Portal>
                <Menu.Content className="menu" align="end" sideOffset={6}>
                  <Menu.Item className="menu-item" onSelect={() => dialogs.renameFolder(folder)}><Pencil /> Rename folder…</Menu.Item>
                  <Menu.Separator className="menu-sep" />
                  <Menu.Item className="menu-item danger" onSelect={() => deleteFolder(folder)}><Trash2 /> Delete folder…</Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          )}
          <button className="btn btn-primary uhead-upload" onClick={openPicker} aria-label={`Upload files to ${target.label}`}><Upload aria-hidden /><span className="hide-xs">Upload</span></button>
        </div>
      </div>
    </header>
  );
}

// ——— Media views: All, Images, Videos, a folder, Trash ———

function MediaView({ loc, title, folder, folders, q, sort, setParam, summary, limits }: {
  loc: Loc; title: string; folder: Folder | null; folders: Folder[]; q: string; sort: SortKey;
  setParam: (p: Record<string, string | null>) => void; summary?: Summary; limits: Limits;
}) {
  const inTrash = loc.kind === "trash";
  const list = useMediaList({ ...mediaScope(loc), q, sort: sort === "newest" ? null : sort });
  const [prefs, setPrefs] = usePrefs();
  const { previewPending } = useUploads();
  const dialogs = useDialogs();
  const { trash, restore, purge, download } = useMediaActions(list.removeLocal);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const anchor = useRef<number | null>(null);
  const selecting = selectMode || selected.size > 0;
  const [lastScope, setLastScope] = useState(`${q}|${sort}`);
  if (`${q}|${sort}` !== lastScope) { setLastScope(`${q}|${sort}`); setSelected(new Set()); }
  const clearSelection = useCallback(() => { setSelected(new Set()); setSelectMode(false); }, []);
  // Drop ids that left the list (trashed, moved out, deleted).
  useEffect(() => {
    setSelected((cur) => {
      if (!cur.size) return cur;
      const live = new Set(list.items.map((m) => m.id));
      const next = new Set([...cur].filter((id) => live.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [list.items]);

  const toggle = useCallback((m: Media, e: React.MouseEvent | React.ChangeEvent) => {
    const idx = list.items.findIndex((x) => x.id === m.id);
    setSelected((cur) => {
      const next = new Set(cur);
      if ("shiftKey" in e && e.shiftKey && anchor.current != null) {
        const [a, b] = [Math.min(anchor.current, idx), Math.max(anchor.current, idx)];
        for (let i = a; i <= b; i++) next.add(list.items[i].id);
      } else if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      return next;
    });
    anchor.current = idx;
  }, [list.items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog],[role=alertdialog],[role=menu]")) return;
      if (e.key === "Escape" && selecting) clearSelection();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && selecting && !(e.target as HTMLElement).closest("input, textarea")) {
        e.preventDefault();
        setSelected(new Set(list.items.map((m) => m.id)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clearSelection, list.items]);

  // Preview & details
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const details = detailsId ? list.items.find((m) => m.id === detailsId) ?? null : null;
  useEffect(() => { if (detailsId && !list.loading && !details) setDetailsId(null); }, [detailsId, details, list.loading]);

  const actions: ItemActions = useMemo(() => ({
    open: (m) => setViewerIndex(list.items.findIndex((x) => x.id === m.id)),
    details: (m) => setDetailsId(m.id),
    toggle,
    move: (m) => dialogs.moveTo([m.id], { currentFolderId: m.folderId }),
    rename: (m) => dialogs.renameFile(m, list.patchLocal),
    download: (m) => download([m]),
    trash: (m) => { trash([m.id]); },
    restore: (m) => { restore([m.id]); },
    purge: (m) => { purge([m.id], m.name); },
  }), [list.items, list.patchLocal, toggle, dialogs, download, trash, restore, purge]);

  // Progressive loading
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasMore, loadMore } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) loadMore(); }, { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  const workspaceEmpty = !!summary && summary.all === 0 && summary.trash === 0;
  const scopeTotal = loc.kind === "folder" ? folder?.count ?? list.total : loc.kind === "all" ? summary?.all ?? list.total : list.total;
  const zoneSize: ZoneSize = workspaceEmpty && loc.kind === "all" ? "hero" : scopeTotal > 8 ? "compact" : "standard";
  const selectedItems = list.items.filter((m) => selected.has(m.id));
  const unit = loc.kind === "images" ? "image" : loc.kind === "videos" ? "video" : "file";

  return (
    <div className="ws-body" data-details={details ? "" : undefined}>
      <main id="main" className="ws-main ws-pad" tabIndex={-1}>
        <div className="view-head">
          <h1 className="view-title">{title}</h1>
          <p className="view-count tabular" aria-live="polite">
            {list.initialLoading ? "Loading…" : q ? `${plural(list.total, unit)} matching “${q}”` : plural(list.total, unit)}
          </p>
        </div>
        {inTrash && (
          <p className="view-note">Files stay in Trash until they&rsquo;re deleted permanently. Restoring returns a file to its original folder if it still exists, otherwise to All media.</p>
        )}

        {!inTrash && (summary ? <UploadZone size={zoneSize} limits={limits} folderName={folder?.name} /> : <div className="zone-skeleton skeleton" aria-hidden />)}

        {!(workspaceEmpty && loc.kind === "all") && (
          <>
            <div className="toolbar" role="toolbar" aria-label="Gallery controls">
              <button className="btn tool-select" aria-pressed={selecting} onClick={() => (selecting ? clearSelection() : setSelectMode(true))} disabled={!list.items.length}>
                <CheckSquare aria-hidden /> {selecting ? "Done selecting" : "Select"}
              </button>
              {selecting && (
                <button className="btn btn-ghost" onClick={() => setSelected(new Set(list.items.map((m) => m.id)))} title="Selects the files currently loaded on this page">
                  Select all loaded ({list.items.length})
                </button>
              )}
              <div className="tool-end">
                <label className="sort">
                  <span className="sr-only">Sort</span>
                  <select className="select" value={sort} onChange={(e) => setParam({ sort: e.target.value === "newest" ? null : e.target.value })}>
                    {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                {prefs.view === "grid" && (
                  <div className="seg" role="group" aria-label="Thumbnail size">
                    {DENSITIES.map((d) => (
                      <button key={d.key} aria-pressed={prefs.density === d.key} onClick={() => setPrefs({ density: d.key })} title={`${d.label} thumbnails`}>
                        <d.icon aria-hidden /><span className="sr-only">{d.label} thumbnails</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="seg" role="group" aria-label="Layout">
                  <button aria-pressed={prefs.view === "grid"} onClick={() => setPrefs({ view: "grid" })} title="Grid view"><LayoutGrid aria-hidden /><span className="sr-only">Grid view</span></button>
                  <button aria-pressed={prefs.view === "list"} onClick={() => setPrefs({ view: "list" })} title="List view"><List aria-hidden /><span className="sr-only">List view</span></button>
                </div>
              </div>
            </div>
            {selecting && list.hasMore && <p className="view-note small">“Select all loaded” selects the {list.items.length} files loaded so far; scroll to load more.</p>}

            {list.error && !list.items.length ? (
              <div className="state" role="alert">
                <span className="state-icon is-danger"><AlertCircle /></span>
                <h2 className="state-title">Couldn&rsquo;t load files</h2>
                <p>{list.error.message}</p>
                <button className="btn" onClick={list.reload}><RotateCw aria-hidden /> Try again</button>
              </div>
            ) : list.initialLoading ? (
              <div className={`gallery dens-${prefs.density}`} aria-busy="true" aria-label="Loading">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card-skel"><div className="skeleton card-skel-frame" /><div className="skeleton card-skel-line" /><div className="skeleton card-skel-line short" /></div>)}
              </div>
            ) : list.items.length === 0 ? (
              <EmptyState loc={loc} q={q} onClear={() => setParam({ q: null })} />
            ) : prefs.view === "grid" ? (
              <ul className={`gallery dens-${prefs.density}`} aria-label={`${title} files`}>
                {list.items.map((m, i) => (
                  <li key={m.id}><MediaCard media={m} actions={actions} inTrash={inTrash} selected={selected.has(m.id)} selecting={selecting} previewPending={previewPending.has(m.id)} eager={i < 8} /></li>
                ))}
              </ul>
            ) : (
              <ul className="rows" aria-label={`${title} files`}>
                <li className="rows-head" aria-hidden><span /><span>Name</span><span className="row-type">Type</span><span className="row-size">Size</span><span className="row-date">{inTrash ? "Trashed" : "Uploaded"}</span><span /></li>
                {list.items.map((m) => (
                  <MediaRow key={m.id} media={m} actions={actions} inTrash={inTrash} selected={selected.has(m.id)} selecting={selecting} previewPending={previewPending.has(m.id)} />
                ))}
              </ul>
            )}
            {list.hasMore && (
              <div ref={sentinel} className="load-more">
                <button className="btn" onClick={list.loadMore} disabled={list.loading}>{list.loading && <span className="spinner" />} Load more</button>
                <span className="subtle tabular">Showing {list.items.length} of {list.total}</span>
              </div>
            )}
          </>
        )}

        {selected.size > 0 && (
          <div className="bulkbar" role="region" aria-label="Actions for selected files">
            <span className="bulk-count tabular" aria-live="polite">{selected.size} selected</span>
            <div className="bulk-actions">
              {inTrash ? (
                <>
                  <button className="btn btn-ghost" onClick={async () => { await restore([...selected]); clearSelection(); }}><RotateCcw aria-hidden /><span>Restore</span></button>
                  <button className="btn btn-danger-ghost" onClick={async () => { if (await purge([...selected])) clearSelection(); }}><Trash2 aria-hidden /><span>Delete permanently</span></button>
                </>
              ) : (
                <>
                  <button className="btn btn-ghost" onClick={() => dialogs.moveTo([...selected], { currentFolderId: selectedItems.every((m) => m.folderId === selectedItems[0]?.folderId) ? selectedItems[0]?.folderId : undefined, onMoved: clearSelection })}><FolderInput aria-hidden /><span>Move to folder</span></button>
                  <button className="btn btn-ghost" onClick={() => download(selectedItems)}><Download aria-hidden /><span>Download</span></button>
                  <button className="btn btn-danger-ghost" onClick={async () => { if (await trash([...selected])) clearSelection(); }}><Trash2 aria-hidden /><span>Move to Trash</span></button>
                </>
              )}
            </div>
            <button className="icon-btn icon-btn-sm" onClick={clearSelection} aria-label="Clear selection"><X /></button>
          </div>
        )}
      </main>

      <DetailsPanel media={details} folders={folders} actions={actions} onClose={() => setDetailsId(null)} />
      <MediaViewer items={list.items} index={viewerIndex} onIndexChange={setViewerIndex} actions={actions} total={list.total} />
    </div>
  );
}

function EmptyState({ loc, q, onClear }: { loc: Loc; q: string; onClear: () => void }) {
  if (q) {
    return (
      <div className="state">
        <span className="state-icon"><SearchX /></span>
        <h2 className="state-title">Nothing matches “{q}”</h2>
        <p>Search looks at file names. Check the spelling or try part of the name.</p>
        <button className="btn" onClick={onClear}>Clear search</button>
      </div>
    );
  }
  const copy: Record<string, [string, string]> = {
    all: ["No files yet", "Upload images or videos to get started."],
    images: ["No images yet", "Upload JPEG, PNG or WebP images and they’ll appear here."],
    videos: ["No videos yet", "Upload MP4 or WebM videos and they’ll appear here."],
    folder: ["This folder is empty", "Drop files above to upload them here, or use “Move to folder” on files in All media."],
    trash: ["Trash is empty", "Files you move to Trash appear here until they’re deleted permanently."],
  };
  const [title, text] = copy[loc.kind] ?? copy.all;
  return (
    <div className="state">
      <span className="state-icon">{loc.kind === "trash" ? <Trash2 /> : loc.kind === "folder" ? <FolderIcon /> : <SearchX />}</span>
      <h2 className="state-title">{title}</h2>
      <p>{text}</p>
      {loc.kind === "folder" && <Link className="btn" href="/">Go to All media</Link>}
    </div>
  );
}

// ——— Folders overview ———

function FoldersView({ folders, loaded, q }: { folders: Folder[]; loaded: boolean; q: string }) {
  const dialogs = useDialogs();
  const shown = q ? folders.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())) : folders;
  return (
    <main id="main" className="ws-main ws-pad" tabIndex={-1}>
      <div className="view-head">
        <h1 className="view-title">Folders</h1>
        <p className="view-count tabular">{loaded ? plural(shown.length, "folder") : "Loading…"}</p>
      </div>
      <p className="view-note">A file can be in one folder at a time. All media always shows every file. Folders are shared with everyone who has access.</p>
      {!loaded ? (
        <div className="folder-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton folder-skel" />)}</div>
      ) : shown.length === 0 ? (
        <div className="state">
          <span className="state-icon"><FolderIcon /></span>
          <h2 className="state-title">{q ? `No folders match “${q}”` : "No folders yet"}</h2>
          <p>{q ? "Try a different name." : "Create a folder to group files for a project or client."}</p>
          {!q && <button className="btn btn-primary" onClick={() => dialogs.newFolder()}><FolderPlus aria-hidden /> New folder</button>}
        </div>
      ) : (
        <ul className="folder-grid" aria-label="Folders">
          {shown.map((f) => (
            <li key={f.id} className="folder-card">
              <Link href={hrefFor({ kind: "folder", id: f.id })} className="folder-open" aria-label={`${f.name}, ${plural(f.count, "file")}`}>
                <span className="folder-cover">
                  {f.cover ? <MediaThumb media={f.cover} /> : <span className="thumb-fallback"><FolderIcon /><span>Empty folder</span></span>}
                </span>
              </Link>
              <div className="card-caption">
                <div className="card-text">
                  <h2 className="card-name" title={f.name}>{f.name}</h2>
                  <p className="card-meta tabular">{plural(f.count, "file")}</p>
                </div>
                <Menu.Root modal={false}>
                  <Menu.Trigger asChild><button className="icon-btn icon-btn-sm item-more" aria-label={`Actions for folder ${f.name}`}><MoreHorizontal /></button></Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content className="menu" align="end" sideOffset={4}>
                      <Menu.Item className="menu-item" asChild><Link href={hrefFor({ kind: "folder", id: f.id })}><FolderIcon /> Open</Link></Menu.Item>
                      <Menu.Item className="menu-item" onSelect={() => dialogs.renameFolder(f)}><Pencil /> Rename…</Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// ——— Uploads view ———

function UploadsView({ limits }: { limits: Limits }) {
  const { items, clearFinished, target } = useUploads();
  const active = items.filter((i) => ACTIVE_STATUSES.includes(i.status));
  const failed = items.filter((i) => i.status === "failed" || i.status === "invalid" || i.status === "canceled");
  const done = items.filter((i) => i.status === "done");
  return (
    <main id="main" className="ws-main ws-pad" tabIndex={-1}>
      <div className="view-head">
        <h1 className="view-title">Uploads</h1>
        <p className="view-count tabular">{active.length ? `${active.length} in progress` : "Nothing uploading"}{failed.length ? ` · ${failed.length} need attention` : ""}</p>
      </div>
      <p className="view-note">Uploads run while this tab stays open. Closing or reloading the tab stops any upload still in progress. New files go to <strong>{target.label}</strong>.</p>
      <UploadZone size="standard" limits={limits} />
      <section className="up-section" aria-labelledby="up-active">
        <h2 id="up-active" className="up-title">In progress</h2>
        {active.length ? <div className="up-panel"><UploadQueueList items={active} /></div> : <p className="muted small">No uploads are running.</p>}
      </section>
      <section className="up-section" aria-labelledby="up-failed">
        <h2 id="up-failed" className="up-title">Needs attention</h2>
        {failed.length ? <div className="up-panel"><UploadQueueList items={failed} /></div> : <p className="muted small">No failed or canceled uploads.</p>}
      </section>
      <section className="up-section" aria-labelledby="up-done">
        <div className="up-title-row">
          <h2 id="up-done" className="up-title">Completed in this tab</h2>
          {done.length > 0 && !active.length && <button className="btn btn-ghost btn-sm" onClick={clearFinished}>Clear list</button>}
        </div>
        {done.length ? <div className="up-panel"><UploadQueueList items={done} /></div> : <p className="muted small">Completed uploads are listed here briefly, then appear in your library.</p>}
      </section>
    </main>
  );
}
