import "server-only";
import { hasAccess } from "./access";

export class HttpError extends Error {
  constructor(public status: number, message: string, public headers?: Record<string, string>) { super(message); }
}

export const json = (data: unknown, init?: number | ResponseInit) =>
  Response.json(data, typeof init === "number" ? { status: init } : init);

export const fail = (status: number, message: string, headers?: Record<string, string>) =>
  Response.json({ error: message }, { status, headers });

/** Header every state-changing request from the app must carry. Browsers can't add it cross-site without CORS. */
export const CSRF_HEADER = "x-nexo-request";

/**
 * CSRF defence for state-changing requests, layered on top of SameSite=Lax cookies:
 * the request must be same-origin (Origin / Sec-Fetch-Site) and carry the custom header.
 */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site request blocked.");
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let ok = false;
    try { ok = new URL(origin).host === host; } catch {}
    if (!ok) throw new HttpError(403, "Cross-site request blocked.");
  }
  if (req.headers.get(CSRF_HEADER) !== "1") throw new HttpError(403, "Request blocked: missing security header.");
}

/** Every media route calls this: it enforces CSRF rules and a valid workspace session. */
export async function requireAccess(req: Request) {
  assertSameOrigin(req);
  if (!(await hasAccess())) throw new HttpError(401, "The workspace is locked. Unlock it to continue.");
}

/** Wraps a route handler so thrown HttpErrors become JSON responses. */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message, e.headers);
      console.error(e);
      return fail(500, "Something went wrong on the server. Please try again.");
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}
