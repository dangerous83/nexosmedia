import { workspaceBrand, type WorkspaceBrand } from "@/lib/types";

export function workspaceFrom(req: Request): WorkspaceBrand {
  const url = new URL(req.url);
  const value = url.searchParams.get("workspace") ?? req.headers.get("x-nexo-workspace");
  return workspaceBrand(value);
}

export function workspaceValue(value: unknown): WorkspaceBrand {
  return workspaceBrand(value);
}
