// Every workspace view is addressable by URL so navigation, reloads and back/forward all work.
//   /                 Interface picker /?view=dashboard Brand dashboard /?view=all All media
//   /?view=videos     Videos
//   /?view=folders    Folder overview  /?folder=<id>   One folder  /?view=trash   Trash
//   /?view=uploads    Uploads

export type Loc =
  | { kind: "launcher" } | { kind: "dashboard" } | { kind: "all" } | { kind: "images" } | { kind: "videos" } | { kind: "folders" }
  | { kind: "folder"; id: string } | { kind: "trash" } | { kind: "uploads" };

export function parseLoc(params: URLSearchParams): Loc {
  const folder = params.get("folder");
  if (folder) return { kind: "folder", id: folder };
  const view = params.get("view");
  if (view === "dashboard" || view === "all" || view === "images" || view === "videos" || view === "folders" || view === "trash" || view === "uploads") return { kind: view };
  return { kind: "launcher" };
}

export function hrefFor(loc: Loc) {
  if (loc.kind === "launcher") return "/";
  if (loc.kind === "all") return "/?view=all";
  if (loc.kind === "folder") return `/?folder=${encodeURIComponent(loc.id)}`;
  return `/?view=${loc.kind}`;
}

export const sameLoc = (a: Loc, b: Loc) => a.kind === b.kind && (a.kind !== "folder" || a.id === (b as { id: string }).id);

/** Query parameters for /api/media for views that list media. */
export function mediaScope(loc: Loc): Record<string, string> | null {
  switch (loc.kind) {
    case "all": return {};
    case "images": return { type: "image" };
    case "videos": return { type: "video" };
    case "folder": return { folder: loc.id };
    case "trash": return { trash: "1" };
    default: return null;
  }
}
