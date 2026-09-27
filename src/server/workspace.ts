import type { WorkspaceBrand } from "@/lib/types";

export function workspaceFrom(req: Request): WorkspaceBrand {
  const url = new URL(req.url);
  const value = url.searchParams.get("workspace") ?? req.headers.get("x-nexo-workspace");
  return value === "nexuflow" ? "nexuflow" : "nexosphere";
}

export function workspaceValue(value: unknown): WorkspaceBrand {
  return value === "nexuflow" ? "nexuflow" : "nexosphere";
}
