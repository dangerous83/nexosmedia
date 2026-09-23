import "server-only";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { config } from "./config";

/*
 * Shared-workspace access. There are no user accounts: anyone who knows the passphrase unlocks the
 * same workspace. The passphrase is never stored — only an scrypt hash, supplied through the
 * NEXO_PASSPHRASE_HASH environment variable (see scripts/set-passphrase.mjs).
 */

export const ACCESS_COOKIE = "nx_access";

type ScryptParams = { N: number; r: number; p: number; maxmem: number };
function scrypt(secret: string, salt: Buffer, len: number, opts: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(secret, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Hash format: scrypt:N:r:p:<salt b64url>:<key b64url> (no `$`, so it is safe in .env files). */
function parseHash(stored: string) {
  const [algo, N, r, p, salt, key] = stored.split(":");
  if (algo !== "scrypt" || !salt || !key) return null;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every((n) => Number.isInteger(n) && n > 0)) return null;
  return { ...params, salt: Buffer.from(salt, "base64url"), key: Buffer.from(key, "base64url") };
}

export const isConfigured = () => parseHash(config.passphraseHash) !== null;

export async function verifyPassphrase(input: string): Promise<boolean> {
  const h = parseHash(config.passphraseHash);
  if (!h || !input) return false;
  const actual = await scrypt(input.normalize("NFKC"), h.salt, h.key.length, {
    N: h.N, r: h.r, p: h.p, maxmem: 256 * h.N * h.r + 1024 * 1024,
  });
  return actual.length === h.key.length && timingSafeEqual(actual, h.key);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Changing the passphrase changes this fingerprint, which invalidates every existing session. */
const passFingerprint = () => sha256(config.passphraseHash).slice(0, 32);

export async function startSession() {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expires = now + config.sessionHours * 3600_000;
  db().prepare("DELETE FROM access_sessions WHERE expires_at < ?").run(now);
  db().prepare("INSERT INTO access_sessions (token_hash, pass_fp, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), passFingerprint(), expires, now);
  (await cookies()).set(ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    expires: new Date(expires),
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (token) db().prepare("DELETE FROM access_sessions WHERE token_hash = ?").run(sha256(token));
  store.delete(ACCESS_COOKIE);
}

/** True when the request carries a valid, unexpired session issued under the current passphrase. */
export async function hasAccess(): Promise<boolean> {
  if (!isConfigured()) return false;
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return false;
  const row = db().prepare("SELECT pass_fp, expires_at FROM access_sessions WHERE token_hash = ?")
    .get(sha256(token)) as { pass_fp: string; expires_at: number } | undefined;
  return !!row && row.expires_at > Date.now() && row.pass_fp === passFingerprint();
}

// ——— Unlock throttling (per server process) ———
// Per-client buckets slow a single guesser; the global bucket caps total guessing even if a client
// rotates or spoofs its forwarded address.
const WINDOW = 15 * 60_000;
const PER_CLIENT = { max: 5, lockMs: 15 * 60_000 };
const GLOBAL = { max: 30, lockMs: 5 * 60_000 };
type Bucket = { fails: number[]; lockedUntil: number };
const buckets = new Map<string, Bucket>();
const globalBucket: Bucket = { fails: [], lockedUntil: 0 };

const bucketFor = (key: string) => {
  let b = buckets.get(key);
  if (!b) { b = { fails: [], lockedUntil: 0 }; buckets.set(key, b); }
  return b;
};

/** Milliseconds until another attempt is allowed, or 0. */
export function unlockBlockedFor(clientKey: string) {
  const now = Date.now();
  return Math.max(0, bucketFor(clientKey).lockedUntil - now, globalBucket.lockedUntil - now);
}

/** Records a failure and returns how many attempts remain for this client before a lockout. */
export function recordFailure(clientKey: string) {
  const now = Date.now();
  for (const [b, lim] of [[bucketFor(clientKey), PER_CLIENT], [globalBucket, GLOBAL]] as const) {
    b.fails = b.fails.filter((t) => now - t < WINDOW);
    b.fails.push(now);
    if (b.fails.length >= lim.max) { b.lockedUntil = now + lim.lockMs; b.fails = []; }
  }
  const b = bucketFor(clientKey);
  return b.lockedUntil > now ? 0 : PER_CLIENT.max - b.fails.length;
}

export function clearFailures(clientKey: string) {
  buckets.delete(clientKey);
}

export function clientKey(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "direct";
}
