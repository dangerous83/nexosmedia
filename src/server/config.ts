import path from "node:path";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  dataDir: path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data"),
  storageDriver: process.env.STORAGE_DRIVER || "local",
  maxImageBytes: num(process.env.MAX_IMAGE_MB, 50) * 1024 * 1024,
  maxVideoBytes: num(process.env.MAX_VIDEO_MB, 1024) * 1024 * 1024,
  /**
   * scrypt hash of the shared workspace passphrase, created with `npm run set-passphrase`.
   * There is deliberately no default: without it the workspace cannot be unlocked.
   */
  passphraseHash: (process.env.NEXO_PASSPHRASE_HASH || "").trim(),
  sessionHours: num(process.env.NEXO_SESSION_HOURS, 12),
  cookieSecure:
    process.env.COOKIE_SECURE != null
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
};
