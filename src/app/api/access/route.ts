import {
  clearFailures, clientKey, endSession, isConfigured, recordFailure, startSession, unlockBlockedFor, verifyPassphrase,
} from "@/server/access";
import { assertSameOrigin, fail, handle, json, readJson } from "@/server/http";

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** Unlock: verify the shared passphrase and issue a session cookie. */
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  if (!isConfigured())
    return fail(503, "This workspace has no passphrase yet. Run “npm run set-passphrase” on the server, then restart it.");
  const key = clientKey(req);
  const blocked = unlockBlockedFor(key);
  if (blocked) {
    return fail(429, `Too many incorrect attempts. Try again in ${minutes(blocked)} minute${minutes(blocked) > 1 ? "s" : ""}.`,
      { "Retry-After": String(Math.ceil(blocked / 1000)) });
  }
  const { passphrase } = await readJson<{ passphrase?: unknown }>(req);
  const input = typeof passphrase === "string" ? passphrase : "";
  if (!input.trim()) return fail(400, "Enter the workspace passphrase.");
  if (input.length > 1024) return fail(400, "That passphrase is too long.");

  if (!(await verifyPassphrase(input))) {
    const left = recordFailure(key);
    await new Promise((r) => setTimeout(r, 350)); // slows automated guessing
    if (left <= 0) {
      const wait = unlockBlockedFor(key);
      return fail(429, `Too many incorrect attempts. Try again in ${minutes(wait)} minutes.`, { "Retry-After": String(Math.ceil(wait / 1000)) });
    }
    return fail(401, `That passphrase isn't correct. ${left} attempt${left === 1 ? "" : "s"} left before a short lockout.`);
  }
  clearFailures(key);
  await startSession();
  return json({ ok: true });
});

/** Lock: invalidate this session and clear the cookie. */
export const DELETE = handle(async (req) => {
  assertSameOrigin(req);
  await endSession();
  return json({ ok: true });
});
