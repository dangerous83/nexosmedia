#!/usr/bin/env node
// Sets the shared workspace passphrase.
//
//   npm run set-passphrase               prompt (hidden) and write NEXO_PASSPHRASE_HASH to .env.local
//   npm run set-passphrase -- --print    prompt and only print the hash (for a hosting provider's secrets)
//   NEXO_NEW_PASSPHRASE=… npm run set-passphrase   non-interactive (CI / scripted setup)
//
// Only an scrypt hash is stored. Restart the server afterwards; existing sessions are signed out.
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const MIN = 6;
const PARAMS = { N: 32768, r: 8, p: 1 };
const printOnly = process.argv.includes("--print");

function hash(passphrase) {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase.normalize("NFKC"), salt, 32, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return `scrypt:${PARAMS.N}:${PARAMS.r}:${PARAMS.p}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); }; // hide typed characters
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

let passphrase = process.env.NEXO_NEW_PASSPHRASE;
if (!passphrase) {
  if (!process.stdin.isTTY) {
    console.error("No terminal available. Set NEXO_NEW_PASSPHRASE to run non-interactively.");
    process.exit(1);
  }
  passphrase = await ask("New workspace passphrase: ");
  const again = await ask("Repeat passphrase: ");
  if (passphrase !== again) { console.error("The passphrases don't match. Nothing was changed."); process.exit(1); }
}
if (passphrase.trim().length < MIN) {
  console.error(`Use at least ${MIN} characters (12 or more is recommended). Nothing was changed.`);
  process.exit(1);
}
if (passphrase.length < 12) console.warn("Note: a passphrase of 12+ characters (or a few random words) is much harder to guess.");

const value = hash(passphrase);
if (printOnly) {
  console.log(`\nNEXO_PASSPHRASE_HASH=${value}\n`);
  process.exit(0);
}

const file = path.resolve(".env.local");
let content = existsSync(file) ? readFileSync(file, "utf8") : "";
const line = `NEXO_PASSPHRASE_HASH=${value}`;
if (/^NEXO_PASSPHRASE_HASH=.*$/m.test(content)) content = content.replace(/^NEXO_PASSPHRASE_HASH=.*$/m, line);
else content += `${content && !content.endsWith("\n") ? "\n" : ""}# Shared workspace passphrase (scrypt hash). Change with: npm run set-passphrase\n${line}\n`;
writeFileSync(file, content, { mode: 0o600 });
console.log(`Saved the passphrase hash to ${path.basename(file)}. Restart the server for it to take effect.`);
