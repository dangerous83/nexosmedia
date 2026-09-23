// Shapes shared by the API and the client.

export type MediaKind = "image" | "video";

export interface Media {
  id: string;
  kind: MediaKind;
  mime: string;
  ext: string;
  /** Display filename (renameable). Storage references never change. */
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  hasThumb: boolean;
  createdAt: number;
  folderId: string | null;
  /** Set while the item is in Trash. Trashed items keep folderId so Restore can return them. */
  trashedAt: number | null;
}

export interface Folder {
  id: string;
  name: string;
  /** Items in the folder, excluding Trash. */
  count: number;
  cover: Pick<Media, "id" | "kind" | "hasThumb" | "width" | "height"> | null;
  createdAt: number;
}

export interface Summary {
  all: number;
  images: number;
  videos: number;
  unfiled: number;
  trash: number;
}

export type SortKey = "newest" | "oldest" | "name" | "size";

export interface MediaPage {
  items: Media[];
  /** Items matching the current scope + search. */
  total: number;
  nextCursor: number | null;
}

/** Bulk downloads are streamed as an uncompressed zip; these limits are shown before starting. */
export const ARCHIVE_LIMITS = { maxFiles: 200, maxBytes: 4 * 1000 * 1000 * 1000 - 64 * 1024 * 1024 } as const;

export const UPLOAD_RULES = {
  image: { mimes: ["image/jpeg", "image/png", "image/webp"], exts: ["jpg", "jpeg", "png", "webp"], label: "JPEG, PNG, WebP" },
  video: { mimes: ["video/mp4", "video/webm"], exts: ["mp4", "m4v", "webm"], label: "MP4, WebM" },
} as const;

export const ACCEPT_ATTR = [
  ...UPLOAD_RULES.image.mimes, ...UPLOAD_RULES.video.mimes,
  ...[...UPLOAD_RULES.image.exts, ...UPLOAD_RULES.video.exts].map((e) => `.${e}`),
].join(",");
