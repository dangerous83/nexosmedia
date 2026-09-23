"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Folder as FolderIcon, FolderPlus, Inbox, X } from "lucide-react";
import { api } from "@/lib/api";
import { invalidateMedia, useQuery } from "@/lib/store";
import { useReturnFocus } from "@/lib/focus";
import { plural } from "@/lib/format";
import { useToast } from "./ToastProvider";
import type { Folder, Media } from "@/lib/types";

/*
 * Shared dialogs: create/rename folder, move to folder, rename file.
 * Every change here applies to the whole shared workspace.
 */

interface Ctx {
  newFolder: (opts?: { thenMove?: string[]; onCreated?: (f: Folder) => void }) => void;
  renameFolder: (f: Folder) => void;
  moveTo: (ids: string[], opts?: { currentFolderId?: string | null; onMoved?: (folderId: string | null) => void }) => void;
  renameFile: (m: Media, onRenamed?: (m: Media) => void) => void;
}
const DialogsCtx = createContext<Ctx | null>(null);

type FolderDlg = { mode: "create"; thenMove?: string[]; onCreated?: (f: Folder) => void } | { mode: "rename"; folder: Folder };
type MoveDlg = { ids: string[]; currentFolderId?: string | null; onMoved?: (folderId: string | null) => void };
type RenameDlg = { media: Media; onRenamed?: (m: Media) => void };

export function DialogsProvider({ children }: { children: React.ReactNode }) {
  const [folderDlg, setFolderDlg] = useState<FolderDlg | null>(null);
  const [moveDlg, setMoveDlg] = useState<MoveDlg | null>(null);
  const [renameDlg, setRenameDlg] = useState<RenameDlg | null>(null);

  const value = useMemo<Ctx>(() => ({
    newFolder: (o) => setFolderDlg({ mode: "create", ...o }),
    renameFolder: (folder) => setFolderDlg({ mode: "rename", folder }),
    moveTo: (ids, o) => setMoveDlg({ ids, ...o }),
    renameFile: (media, onRenamed) => setRenameDlg({ media, onRenamed }),
  }), []);

  return (
    <DialogsCtx.Provider value={value}>
      {children}
      <FolderDialog state={folderDlg} onClose={() => setFolderDlg(null)} />
      <MoveDialog state={moveDlg} onClose={() => setMoveDlg(null)} onNewFolder={(ids) => { setMoveDlg(null); setFolderDlg({ mode: "create", thenMove: ids }); }} />
      <RenameDialog state={renameDlg} onClose={() => setRenameDlg(null)} />
    </DialogsCtx.Provider>
  );
}

export function useDialogs() {
  const v = useContext(DialogsCtx);
  if (!v) throw new Error("useDialogs must be used inside DialogsProvider");
  return v;
}

function Shell({ open, onClose, title, desc, children }: { open: boolean; onClose: () => void; title: string; desc: React.ReactNode; children: React.ReactNode }) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" onCloseAutoFocus={returnFocus}>
          <Dialog.Title className="dialog-title">{title}</Dialog.Title>
          <Dialog.Description asChild><div className="dialog-desc">{desc}</div></Dialog.Description>
          <Dialog.Close asChild><button className="icon-btn icon-btn-sm dialog-x" aria-label="Close"><X /></button></Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FolderDialog({ state, onClose }: { state: FolderDlg | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<FolderDlg | null>(null);
  if (state !== last) { setLast(state); setName(state?.mode === "rename" ? state.folder.name : ""); setError(null); }
  const rename = state?.mode === "rename";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    if (!name.trim()) { setError("Give the folder a name."); return; }
    setBusy(true);
    try {
      if (state.mode === "rename") {
        await api(`/api/folders/${state.folder.id}`, { method: "PATCH", json: { name } });
        toast({ title: "Folder renamed", description: `Now called “${name.trim()}”.` });
        onClose();
      } else {
        const { folder } = await api<{ folder: Folder }>("/api/folders", { method: "POST", json: { name } });
        if (state.thenMove?.length) {
          await api("/api/media/actions", { method: "POST", json: { action: "move", ids: state.thenMove, folderId: folder.id } });
          toast({ title: `Moved ${plural(state.thenMove.length, "file")} to “${folder.name}”` });
        } else {
          toast({ title: `Created “${folder.name}”` });
        }
        state.onCreated?.(folder);
        onClose();
      }
      invalidateMedia();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell open={!!state} onClose={onClose} title={rename ? "Rename folder" : "New folder"}
      desc={rename ? "The new name is visible to everyone with access to this workspace." : "Folders help organize the shared workspace. A file can be in one folder at a time."}>
      <form onSubmit={submit} className="dialog-form">
        <label className="field">
          <span className="field-label">Folder name</span>
          <input className="input" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={60} autoFocus placeholder="e.g. Spring campaign" aria-invalid={!!error} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <Dialog.Close asChild><button type="button" className="btn btn-ghost">Cancel</button></Dialog.Close>
          <button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner" />}{rename ? "Save" : state?.mode === "create" && state.thenMove?.length ? "Create and move" : "Create folder"}</button>
        </div>
      </form>
    </Shell>
  );
}

function MoveDialog({ state, onClose, onNewFolder }: { state: MoveDlg | null; onClose: () => void; onNewFolder: (ids: string[]) => void }) {
  const toast = useToast();
  const { data } = useQuery<{ folders: Folder[] }>(state ? "/api/folders" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const folders = data?.folders ?? [];

  const move = useCallback(async (folderId: string | null, label: string) => {
    if (!state) return;
    setBusy(folderId ?? "none");
    try {
      const r = await api<{ moved: number }>("/api/media/actions", { method: "POST", json: { action: "move", ids: state.ids, folderId } });
      invalidateMedia();
      toast({ title: folderId ? `Moved to “${label}”` : "Removed from folder", description: `${plural(r.moved, "file")}${folderId ? "" : " now unfiled in All media"}.` });
      state.onMoved?.(folderId);
      onClose();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't move files", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }, [state, toast, onClose]);

  const current = state?.currentFolderId;
  return (
    <Shell open={!!state} onClose={onClose} title="Move to folder"
      desc={state ? `Choose where to put ${plural(state.ids.length, "file")}. The change applies to everyone with access.` : ""}>
      <ul className="move-list" role="list">
        <li>
          <button className="move-row" onClick={() => move(null, "All media")} disabled={!!busy || current === null} aria-current={current === null || undefined}>
            <span className="move-icon"><Inbox aria-hidden /></span>
            <span className="move-text"><span className="move-name">No folder</span><span className="move-meta">Keep in All media only</span></span>
            {busy === "none" ? <span className="spinner" /> : current === null ? <span className="move-here"><Check aria-hidden /> Current</span> : null}
          </button>
        </li>
        {folders.map((f) => (
          <li key={f.id}>
            <button className="move-row" onClick={() => move(f.id, f.name)} disabled={!!busy || current === f.id} aria-current={current === f.id || undefined}>
              <span className="move-icon"><FolderIcon aria-hidden /></span>
              <span className="move-text"><span className="move-name">{f.name}</span><span className="move-meta">{plural(f.count, "file")}</span></span>
              {busy === f.id ? <span className="spinner" /> : current === f.id ? <span className="move-here"><Check aria-hidden /> Current</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="dialog-actions spread">
        <button className="btn" onClick={() => state && onNewFolder(state.ids)}><FolderPlus aria-hidden /> New folder</button>
        <Dialog.Close asChild><button className="btn btn-ghost">Cancel</button></Dialog.Close>
      </div>
    </Shell>
  );
}

function RenameDialog({ state, onClose }: { state: RenameDlg | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<RenameDlg | null>(null);
  const ext = state?.media.name.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? (state ? `.${state.media.ext}` : "");
  if (state !== last) { setLast(state); setName(state ? state.media.name.slice(0, state.media.name.length - ext.length) : ""); setError(null); }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    if (!name.trim()) { setError("Enter a file name."); return; }
    setBusy(true);
    try {
      const { media } = await api<{ media: Media }>(`/api/media/${state.media.id}`, { method: "PATCH", json: { name } });
      toast({ title: "Renamed", description: media.name });
      state.onRenamed?.(media);
      invalidateMedia();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell open={!!state} onClose={onClose} title="Rename file" desc="Changes the name shown in the workspace and used for downloads. The file itself and its format don't change.">
      <form onSubmit={submit} className="dialog-form">
        <div className="field">
          <label className="field-label" htmlFor="rename-input">File name</label>
          <span className="rename-field">
            <input id="rename-input" className="input" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={200} autoFocus onFocus={(e) => e.currentTarget.select()} aria-invalid={!!error} aria-describedby="rename-ext" />
            <span id="rename-ext" className="rename-ext">{ext}</span>
          </span>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <Dialog.Close asChild><button type="button" className="btn btn-ghost">Cancel</button></Dialog.Close>
          <button className="btn btn-primary" disabled={busy}>{busy && <span className="spinner" />}Rename</button>
        </div>
      </form>
    </Shell>
  );
}
