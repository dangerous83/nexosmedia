"use client";

import { useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Expand, FolderInput, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { MediaThumb } from "./MediaThumb";
import type { ItemActions } from "./MediaItem";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useReturnFocus } from "@/lib/focus";
import { dimensions, formatBytes, formatDate, formatDuration, mediaFormat } from "@/lib/format";
import type { Folder, Media } from "@/lib/types";

interface Props {
  media: Media | null;
  folders: Folder[];
  actions: ItemActions;
  onClose: () => void;
}

/** Right-hand panel on desktop; an accessible bottom sheet on smaller screens. */
export function DetailsPanel({ media, folders, actions, onClose }: Props) {
  const docked = useMediaQuery("(min-width: 1100px)", true);
  const returnFocus = useReturnFocus(() => (media ? document.querySelector<HTMLElement>(`[data-mid="${media.id}"]`) : null));
  const panelRef = useRef<HTMLElement>(null);

  // Docked: move focus into the panel when it opens, and close on Escape.
  useEffect(() => {
    if (!docked || !media) return;
    panelRef.current?.querySelector<HTMLElement>(".details-close")?.focus();
  }, [docked, media?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!docked || !media) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelRef.current?.contains(document.activeElement) && !document.querySelector("[role=dialog],[role=alertdialog]")) {
        onClose();
        document.querySelector<HTMLElement>(`[data-mid="${media.id}"]`)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docked, media, onClose]);

  if (docked) {
    if (!media) return null;
    return (
      <aside ref={panelRef} className="details" aria-labelledby="details-title">
        <Body media={media} folders={folders} actions={actions} onClose={onClose} />
      </aside>
    );
  }
  return (
    <Dialog.Root open={!!media} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="sheet" aria-describedby={undefined} onCloseAutoFocus={returnFocus}>
          {media && <Body media={media} folders={folders} actions={actions} onClose={onClose} sheet />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({ media, folders, actions, onClose, sheet }: { media: Media; folders: Folder[]; actions: ItemActions; onClose: () => void; sheet?: boolean }) {
  const inTrash = media.trashedAt != null;
  const folder = media.folderId ? folders.find((f) => f.id === media.folderId) : null;
  const Title = sheet ? Dialog.Title : "h2";
  return (
    <>
      <header className="details-head">
        <Title id="details-title" className="details-heading">Details</Title>
        <button className="icon-btn icon-btn-sm details-close" onClick={onClose} aria-label="Close details"><X /></button>
      </header>
      <button className="details-preview" onClick={() => actions.open(media)} aria-label={`Open preview of ${media.name}`}>
        <span className="card-frame"><MediaThumb media={media} /></span>
        <span className="card-hint"><Expand aria-hidden /> Preview</span>
      </button>
      <div className="details-name-row">
        <h3 className="details-name">{media.name}</h3>
        {!inTrash && <button className="icon-btn icon-btn-sm" onClick={() => actions.rename(media)} aria-label="Rename file"><Pencil /></button>}
      </div>
      <dl className="details-dl">
        <div><dt>Type</dt><dd>{media.kind === "video" ? "Video" : "Image"} · {mediaFormat(media)}</dd></div>
        <div><dt>Size</dt><dd className="tabular">{formatBytes(media.size, 2)}</dd></div>
        {dimensions(media) && <div><dt>Dimensions</dt><dd className="tabular">{dimensions(media)} px</dd></div>}
        {media.kind === "video" && <div><dt>Duration</dt><dd className="tabular">{formatDuration(media.duration) || "Unknown"}</dd></div>}
        <div><dt>Uploaded</dt><dd className="tabular">{formatDate(media.createdAt)}</dd></div>
        <div><dt>Folder</dt><dd>{folder ? folder.name : media.folderId ? "Deleted folder" : "No folder"}</dd></div>
        {inTrash && <div><dt>In Trash since</dt><dd className="tabular">{formatDate(media.trashedAt!)}</dd></div>}
      </dl>
      <div className="details-actions">
        <button className="btn" onClick={() => actions.download(media)}><Download aria-hidden /> Download</button>
        {inTrash ? (
          <>
            <button className="btn" onClick={() => actions.restore(media)}><RotateCcw aria-hidden /> Restore</button>
            <button className="btn btn-danger-ghost" onClick={() => actions.purge(media)}><Trash2 aria-hidden /> Delete permanently</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => actions.move(media)}><FolderInput aria-hidden /> Move to folder</button>
            <button className="btn" onClick={() => actions.rename(media)}><Pencil aria-hidden /> Rename</button>
            <button className="btn btn-danger-ghost" onClick={() => actions.trash(media)}><Trash2 aria-hidden /> Move to Trash</button>
          </>
        )}
      </div>
      {inTrash && <p className="details-note">Restoring returns the file to its original folder if it still exists, otherwise to All media.</p>}
    </>
  );
}
