# NEXOSPHERE Media Space

A private, passphrase-protected space to upload images and videos, organize them in folders, and browse, preview and download them.

The flow is: **unlock the workspace → upload images or videos → browse and preview them.**

This is a single shared workspace, not a multi-user app. Anyone who knows the passphrase sees the same media and can upload, organize, download and delete files. Folder changes, renames and Trash actions apply to everyone. There are no user accounts.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, SQLite through Node's built-in `node:sqlite`, `sharp` for image validation and thumbnails, Radix UI for dialogs and menus, Lucide icons, and hand-written CSS with design tokens (`src/styles/tokens.css`).

## Run it

Requirements: **Node.js 22.13 or later** (24 recommended).

```bash
npm install
npm run set-passphrase   # choose the workspace passphrase (see below)
npm run build
npm start                # http://localhost:3000
```

For development, use `npm run dev` instead of `build` and `start`. Node prints `ExperimentalWarning: SQLite is an experimental feature` at startup. This is expected with `node:sqlite` and is harmless.

## The access passphrase

There is **no default passphrase**. Until one is configured, the access screen explains how to set it and refuses to unlock.

- **Set or change it:** run `npm run set-passphrase`, type the passphrase twice (input is hidden), then restart the server.
  - The script stores only an **scrypt hash**, as `NEXO_PASSPHRASE_HASH` in `.env.local`. That file is ignored by git.
  - The passphrase itself is never stored or sent to the browser.
  - Changing it signs out every device that was unlocked with the old passphrase.
- **Hosting providers:** run `npm run set-passphrase -- --print` and paste the printed `NEXO_PASSPHRASE_HASH=…` value into the provider's secret or environment settings.
- **Scripted setup:** set `NEXO_NEW_PASSPHRASE=… npm run set-passphrase`.
- **Length:** at least 6 characters are required. Use 12 or more, or a few random words.

How access is protected:

- **Verification:** the passphrase is checked on the server against the scrypt hash, with a constant-time comparison.
- **Sessions:** unlocking issues a random session token in an `HttpOnly`, `SameSite=Lax` cookie. The cookie is `Secure` when `NODE_ENV=production`, so serve production over HTTPS. Only a hash of the token is stored in the database.
- **Expiry:** sessions expire after `NEXO_SESSION_HOURS` (default 12). **Lock** deletes the session on the server, so the token can't be reused.
- **Rate limiting:** after 5 wrong attempts from one client, that client waits 15 minutes. After 30 wrong attempts across all clients in 15 minutes, unlocking pauses for 5 minutes for everyone. The limits are held in memory, so a server restart clears them.
- **CSRF:** every state-changing request must be same-origin (`Origin` and `Sec-Fetch-Site` are checked) and carry an `X-Nexo-Request` header, which other sites can't add.
- **Protected routes:** every media route requires a valid session. That covers the listing, uploads, thumbnails, previews, downloads, folders, moves, renames, Trash and bulk downloads. The pages redirect to `/unlock` without one. Hiding navigation is never used as protection.

## Where files are stored

Everything lives under `DATA_DIR` (default `./data`):

| Path | Contents |
| --- | --- |
| `data/nexosphere.db` | SQLite database: media records, folders, Trash state and access sessions |
| `data/storage/media/<id>/original.<ext>` | Uploaded originals, byte-for-byte as uploaded |
| `data/storage/media/<id>/thumb.webp` | Generated thumbnail (images) or captured poster frame (videos) |
| `data/tmp/` | In-flight uploads; partial files are deleted when an upload fails or is canceled |

Originals are never placed in `public/`. They are only reachable through authorized routes such as `/api/media/<id>/file`, which support HTTP Range requests for video seeking.

**Upgrades and backups.** Before any schema change, the server writes a full copy of the database as `data/nexosphere.v<N>-backup.db`, then migrates it:

- **From the account-based version (v1):** every media record and file is kept, with the same IDs and storage paths. Accounts, collections, favorites and titles/tags are dropped from the live database, because this product no longer has them. They stay in `nexosphere.v1-backup.db`.
- **Folders and Trash (v3):** purely additive. It adds a `folders` table and two nullable columns on `media` (`folder_id` and `trashed_at`). Existing media starts unfiled and not in Trash.

## Organizing media

- **Folders:** one level, no nesting. A file is in at most one folder, and **All media** always shows every file. You can create, rename and delete folders, move files in or out with **Move to folder** (in each file's menu, the details panel, or the bulk bar), and upload straight into the open folder. Deleting a folder moves its files back to All media; no file is deleted. If a folder is deleted while an upload is heading to it, the file is saved to All media and the upload tray says so.
- **Rename:** changes only the display filename used in the workspace and for downloads. The extension always matches the real format, and the stored file is untouched.
- **Trash:** **Move to Trash** hides files from every view and from search, and offers **Undo**. Trash lists them with **Restore**, which returns a file to its original folder if it still exists, otherwise to All media. **Delete permanently** and **Empty Trash** always ask for confirmation, then remove the original, the thumbnail and the record. Files stay in Trash until someone deletes them; nothing expires automatically.
- **Selection and bulk actions:** use **Select**, or the checkbox on any file, to choose files, then **Move to folder**, **Download** or **Move to Trash**. **Select all loaded** selects only the files loaded so far, not ones further down the list.
- **Bulk download:** the server first checks that every selected file is available, then streams one uncompressed zip straight from storage, so memory use stays flat. The limit is **200 files and 4 GB per download**, shown before the download starts. A download link is single-use and expires after five minutes.
- **View preferences:** grid or list, thumbnail size, and a collapsed sidebar are saved in this browser (`localStorage`). They are not credentials and aren't shared.

## Uploads

- **Formats:** JPEG, PNG and WebP images (default limit 50 MB), and MP4 and WebM videos (default limit 1 GB).
- **Adding files:** drag files anywhere in the window, use **Upload files** or **Browse files**, or use the mobile photo/video picker.
- **Validation:** the server checks each file's actual contents, not its extension. GIF, HEIC, AVIF and MOV get specific conversion advice.
- **Progress:** progress is the real byte count sent by the browser. Stages are shown separately: *transfer complete, saving and creating thumbnail*, then (for videos) *saved, creating video preview*. A file appears in the gallery only after it and its record are saved; a video that is still getting its preview frame is shown as “Creating preview…”. Cancel discards the partial file on the server. Failures stay in the tray and in **Uploads → Needs attention** until retried or dismissed.
- **Keep the tab open:** uploads run in this browser tab and stop if it is closed or reloaded.
- **Videos:** there is no server-side video decoder. The uploading browser reads the video's duration and size and captures the poster frame. A video whose codec a browser can't play (for example HEVC) is still stored; the preview explains this and offers the download.

## Configuration

See `.env.example`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXO_PASSPHRASE_HASH` | — (required) | scrypt hash from `npm run set-passphrase` |
| `NEXO_SESSION_HOURS` | `12` | Session lifetime |
| `DATA_DIR` | `./data` | Database and files |
| `STORAGE_DRIVER` | `local` | Only `local` is implemented |
| `MAX_IMAGE_MB` / `MAX_VIDEO_MB` | `50` / `1024` | Upload limits |
| `COOKIE_SECURE` | `true` in production | Set to `false` only to test a production build over plain HTTP on a LAN |

## Deployment requirements

- **Persistent disk:** local storage needs a disk that survives restarts and redeploys. Serverless functions and containers without a mounted volume will lose uploads. Run on a VM or container with `DATA_DIR` on a persistent volume.
- **HTTPS:** serve production over HTTPS so the `Secure` session cookie works.
- **Passphrase secret:** set `NEXO_PASSPHRASE_HASH` as a secret on the host.
- **Object storage:** not included. Storage goes through the `StorageAdapter` interface (`src/server/storage/types.ts`). To use S3, R2, GCS or Azure Blob, add an implementation, register it in `src/server/storage/index.ts` under a new `STORAGE_DRIVER` value, and supply its credentials through environment variables. The routes and UI don't need to change.
- **Multiple instances:** the unlock rate limiter and bulk-download tokens are held per process. If you run several instances, add a shared limit at your proxy (for example on `POST /api/access`) and use sticky sessions, or a shared store, for `/api/media/archive`.

## Tests

Both suites need a running server that uses a known test passphrase and a scratch data folder:

```bash
HASH=$(NEXO_NEW_PASSPHRASE=test-passphrase-123 node scripts/set-passphrase.mjs --print | grep HASH | cut -d= -f2-)
NEXO_PASSPHRASE_HASH="$HASH" DATA_DIR=./test-data MAX_IMAGE_MB=5 npm start
BASE=http://localhost:3000 PASSPHRASE=test-passphrase-123 DATA_DIR=./test-data node tests/api.mjs
# The browser suite expects an empty workspace and default limits:
NEXO_PASSPHRASE_HASH="$HASH" DATA_DIR=./test-data-2 npm start
BASE=http://localhost:3000 PASSPHRASE=test-passphrase-123 node tests/e2e.mjs
```

- **`tests/api.mjs`** (93 checks) covers:
  - access protection, including every new route when locked
  - uploads and content validation
  - search, filters and all four sorts
  - rename keeping the format
  - folders: create, rename, duplicate names, moves, uploading into a folder or into a deleted one, delete keeping files
  - Trash: hidden from views and search, restore to the original folder or to unfiled, permanent delete of Trash items only, files removed from disk
  - zip downloads: CRC and byte-for-byte checks, single-use tokens
- **`tests/e2e.mjs`** (90 checks, Playwright Chromium) covers:
  - the sidebar, empty state, uploads, progress, cancel and retry from the Uploads view
  - saved view preferences
  - folders via the sidebar and the menus, and uploading into a folder
  - selection with separate checkboxes, bulk zip download, bulk move, Select all, Esc to clear
  - Trash with Undo, Restore and permanent delete
  - the details panel with rename, preview and video, list view, deleting a folder
  - phone drawer and details sheet, tablet rail
  - no horizontal overflow at 360–1920 px, locking, and no console errors

## Brand assets

The official logo files are in `brand/`. None of them has transparency, so `npm run brand:assets` (`scripts/extract-brand-assets.mjs`) derives transparent web assets without redrawing anything. The output goes to `public/brand/` and the app icons in `src/app/`.
