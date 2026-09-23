"use client";

import { memo } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Download, Expand, FolderInput, Info, Loader2, MoreHorizontal, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { MediaThumb } from "./MediaThumb";
import { dimensions, formatBytes, formatDate, formatDuration, mediaFormat } from "@/lib/format";
import type { Media } from "@/lib/types";

export interface ItemActions {
  open: (m: Media) => void;
  details: (m: Media) => void;
  toggle: (m: Media, e: React.MouseEvent | React.ChangeEvent) => void;
  move: (m: Media) => void;
  rename: (m: Media) => void;
  download: (m: Media) => void;
  trash: (m: Media) => void;
  restore: (m: Media) => void;
  purge: (m: Media) => void;
}

interface ItemProps {
  media: Media;
  actions: ItemActions;
  inTrash: boolean;
  selected: boolean;
  selecting: boolean;
  previewPending: boolean;
  eager?: boolean;
}

export function ItemMenu({ media, actions, inTrash }: { media: Media; actions: ItemActions; inTrash: boolean }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button className="icon-btn icon-btn-sm item-more" aria-label={`Actions for ${media.name}`}><MoreHorizontal /></button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={4} collisionPadding={12}>
          <Menu.Item className="menu-item" onSelect={() => actions.open(media)}><Expand /> Preview</Menu.Item>
          <Menu.Item className="menu-item" onSelect={() => actions.details(media)}><Info /> Details</Menu.Item>
          <Menu.Item className="menu-item" onSelect={() => actions.download(media)}><Download /> Download</Menu.Item>
          {inTrash ? (
            <>
              <Menu.Separator className="menu-sep" />
              <Menu.Item className="menu-item" onSelect={() => actions.restore(media)}><RotateCcw /> Restore</Menu.Item>
              <Menu.Item className="menu-item danger" onSelect={() => actions.purge(media)}><Trash2 /> Delete permanently…</Menu.Item>
            </>
          ) : (
            <>
              <Menu.Item className="menu-item" onSelect={() => actions.move(media)}><FolderInput /> Move to folder…</Menu.Item>
              <Menu.Item className="menu-item" onSelect={() => actions.rename(media)}><Pencil /> Rename…</Menu.Item>
              <Menu.Separator className="menu-sep" />
              <Menu.Item className="menu-item danger" onSelect={() => actions.trash(media)}><Trash2 /> Move to Trash</Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Check({ media, selected, actions }: { media: Media; selected: boolean; actions: ItemActions }) {
  return (
    <label className="item-check" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" className="check" checked={selected} onChange={(e) => actions.toggle(media, e)} aria-label={`Select ${media.name}`} />
    </label>
  );
}

export const MediaCard = memo(function MediaCard({ media, actions, inTrash, selected, selecting, previewPending, eager }: ItemProps) {
  const isVideo = media.kind === "video";
  const duration = formatDuration(media.duration);
  return (
    <article className="card" data-selected={selected || undefined} data-selecting={selecting || undefined}>
      <button
        type="button"
        className="card-open"
        data-mid={media.id}
        onClick={(e) => (selecting ? actions.toggle(media, e) : actions.open(media))}
        aria-label={selecting ? `${selected ? "Deselect" : "Select"} ${media.name}` : `Preview ${media.name}`}
      >
        <span className="card-frame">
          {previewPending && !media.hasThumb ? (
            <span className="thumb-fallback is-pending"><Loader2 className="spin" aria-hidden /><span>Creating preview…</span></span>
          ) : (
            <MediaThumb media={media} eager={eager} />
          )}
          {isVideo && (
            <span className="card-badge" aria-hidden><Play />{duration && <span className="tabular">{duration}</span>}</span>
          )}
          {!selecting && <span className="card-hint" aria-hidden><Expand /> Preview</span>}
        </span>
      </button>
      <Check media={media} selected={selected} actions={actions} />
      <div className="card-caption">
        <div className="card-text">
          <h3 className="card-name" title={media.name}>{media.name}</h3>
          <p className="card-meta tabular" title={dimensions(media) || undefined}>
            <span className="card-type"><span className="card-kind-word">{isVideo ? "Video" : "Image"} · </span>{mediaFormat(media)}</span>
            <span aria-hidden> · </span>{formatBytes(media.size)}
          </p>
        </div>
        <ItemMenu media={media} actions={actions} inTrash={inTrash} />
      </div>
    </article>
  );
});

export const MediaRow = memo(function MediaRow({ media, actions, inTrash, selected, selecting, previewPending }: ItemProps) {
  const isVideo = media.kind === "video";
  return (
    <li className="row" data-selected={selected || undefined}>
      <Check media={media} selected={selected} actions={actions} />
      <button
        type="button"
        className="row-open"
        data-mid={media.id}
        onClick={(e) => (selecting ? actions.toggle(media, e) : actions.open(media))}
        aria-label={selecting ? `${selected ? "Deselect" : "Select"} ${media.name}` : `Preview ${media.name}`}
      >
        <span className="row-thumb">
          {previewPending && !media.hasThumb
            ? <span className="thumb-fallback is-pending"><Loader2 className="spin" aria-hidden /></span>
            : <MediaThumb media={media} />}
          {isVideo && <span className="row-play" aria-hidden><Play /></span>}
        </span>
        <span className="row-name">
          <span className="row-title" title={media.name}>{media.name}</span>
          <span className="row-sub tabular">{mediaFormat(media)} · {formatBytes(media.size)}</span>
        </span>
      </button>
      <span className="row-col row-type">{isVideo ? "Video" : "Image"} · {mediaFormat(media)}{isVideo && media.duration ? ` · ${formatDuration(media.duration)}` : ""}</span>
      <span className="row-col row-size tabular">{formatBytes(media.size)}</span>
      <span className="row-col row-date tabular">{formatDate(inTrash && media.trashedAt ? media.trashedAt : media.createdAt)}</span>
      <ItemMenu media={media} actions={actions} inTrash={inTrash} />
    </li>
  );
});
