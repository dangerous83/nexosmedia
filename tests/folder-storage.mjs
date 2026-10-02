// Exercise the real metadata/database modules with a disk-backed fake cloud store.
// Separate processes and SQLite directories model cold serverless instances.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = await mkdtemp(path.join(tmpdir(), "nexo-folder-storage-"));
try {
  for (const name of ["config", "db", "media", "blob-meta", "types"]) {
    const source = await readFile(new URL(`../src/${name === "types" ? "lib" : "server"}/${name}.ts`, import.meta.url), "utf8");
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
      .replace(/import "server-only";/g, "")
      .replace(/from "@\/lib\/types"/g, 'from "./types.mjs"')
      .replace(/from "\.\/([^".]+)"/g, 'from "./$1.mjs"');
    await writeFile(path.join(root, `${name}.mjs`), js);
  }
  await writeFile(path.join(root, "http.mjs"), `export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }`);
  await writeFile(path.join(root, "storage.mjs"), `
    import {mkdir, readFile, writeFile, readdir, rm} from 'node:fs/promises';
    import path from 'node:path'; import {Readable} from 'node:stream';
    const root = process.env.METADATA_DIR;
    export function storage() { return {
      async putBuffer(key, data) { const file = path.join(root, key); await mkdir(path.dirname(file), {recursive:true}); await writeFile(file,data); },
      async read(key) { return Readable.from([await readFile(path.join(root,key))]); },
      async list(prefix) { try { return (await readdir(root,{recursive:true})).filter(key=>key.startsWith(prefix)&&key.endsWith('.json')); } catch(e) { if(e.code==='ENOENT') return []; throw e; } },
      async delete(key) { await rm(path.join(root,key),{force:true}); }
    }; }
  `);
  const phases = [
    `for (const workspace of ['nexosphere','nexuflow','nexotv']) {
       const folder=m.createFolder(workspace,'Projects'); await meta.persistFolder(workspace,folder.id);
       const empty=m.createFolder(workspace,'Empty folder'); await meta.persistFolder(workspace,empty.id);
       m.insertMedia({id:workspace,kind:'image',mime:'image/png',ext:'png',original_name:'asset.png',size:1,width:1,height:1,duration:null,storage_key:workspace+'.png',thumb_key:null,created_at:1,folder_id:folder.id,workspace});
       await meta.persistMedia(workspace);
     }`,
    `await meta.syncMediaMetadata();
     for (const workspace of ['nexosphere','nexuflow','nexotv']) {
       const folders=m.listFolders(workspace); assert.equal(folders.length,2);
       assert.equal(folders.find(f=>f.name==='Projects').count,1);
       const empty=folders.find(f=>f.name==='Empty folder');
       assert.equal(m.moveMedia(workspace,[workspace],empty.id),1); await meta.persistMedia(workspace);
       m.renameFolder(workspace,empty.id,'Delivery'); await meta.persistFolder(workspace,empty.id);
     }`,
    `await meta.syncMediaMetadata();
     for (const workspace of ['nexosphere','nexuflow','nexotv']) {
       const folder=m.listFolders(workspace).find(f=>f.name==='Delivery'); assert.equal(folder.count,1);
       assert.equal(m.getRow(workspace).folder_id,folder.id);
       assert.throws(()=>m.moveMedia(workspace,[workspace],m.listFolders(workspace==='nexotv'?'nexosphere':'nexotv')[0].id));
       await meta.persistFolderDeletion(m.getFolderRow(workspace,folder.id));
       m.deleteFolder(workspace,folder.id); await meta.persistMedia(workspace);
     }`,
    `await meta.syncMediaMetadata();
     for (const workspace of ['nexosphere','nexuflow','nexotv']) {
       assert.equal(m.listFolders(workspace).length,1); assert.equal(m.getRow(workspace).folder_id,null);
       assert.equal(m.summary(workspace).all,1);
     }
     const legacy={...m.getRow('nexotv'),id:'legacy',folder_id:'missing-folder'};
     m.upsertMedia(legacy); assert.equal(m.getRow('legacy').folder_id,null);`
  ];
  for (const [index, phase] of phases.entries()) {
    const script = `import assert from 'node:assert/strict'; import * as m from './media.mjs'; import * as meta from './blob-meta.mjs'; ${phase}`;
    const file = path.join(root, "phase.mjs"); await writeFile(file, script);
    const result = spawnSync(process.execPath, [file], { encoding: "utf8", env: { ...process.env, STORAGE_DRIVER: "test-cloud", DATA_DIR: path.join(root, `cache-${index}`), METADATA_DIR: path.join(root, "cloud") } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  console.log("Passed: empty folders, folder moves, renames, deletion and media survive cold starts in all three workspaces; cross-workspace destinations are rejected.");
} finally { await rm(root, { recursive: true, force: true }); }
