"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Header required by the server on every state-changing request (CSRF defence). */
export const CSRF_HEADERS = { "X-Nexo-Request": "1" } as const;

export function toUnlock() {
  window.location.href = "/unlock";
}

/** JSON fetch helper with consistent, human-readable errors. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(rest.method && rest.method !== "GET" ? CSRF_HEADERS : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/access")) toUnlock();
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export const mediaUrl = {
  thumb: (m: { id: string; hasThumb: boolean }) => `/api/media/${m.id}/thumb?p=${m.hasThumb ? 1 : 0}`,
  file: (m: { id: string }) => `/api/media/${m.id}/file`,
  download: (m: { id: string }) => `/api/media/${m.id}/file?download=1`,
};
