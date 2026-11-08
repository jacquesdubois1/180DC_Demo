import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * File storage behind one interface. Metadata always lives in `files` (with RLS);
 * content lives in one of three backends:
 *   database  bytea table, for demos (works on any Postgres, zero setup)
 *   disk      local folder, for development
 *   supabase  private Supabase Storage bucket, for production
 * Access is decided by the caller through RLS on `files` (app.can_access_file) BEFORE
 * readFile() is called; readFile itself runs with the service role.
 */

export interface StoredFile {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

function supabaseAdmin() {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase storage needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function storeFile(input: {
  bucket: string;
  path: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
  createdBy: string | null;
}): Promise<StoredFile> {
  const backend = env().STORAGE_BACKEND;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (backend === "supabase") {
    const { error } = await supabaseAdmin().storage.from(input.bucket)
      .upload(input.path, input.bytes, { contentType: input.contentType, upsert: false });
    if (error) throw new Error(`Upload failed: ${error.message}`);
  } else if (backend === "disk") {
    const full = path.join(process.cwd(), env().STORAGE_DISK_PATH, input.bucket, input.path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.bytes);
  }
  return withService(async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into files (bucket, path, filename, content_type, size_bytes, sha256, storage_backend, created_by)
      values (${input.bucket}, ${input.path}, ${input.filename}, ${input.contentType}, ${input.bytes.length}, ${sha256},
              ${backend}, ${input.createdBy})
      returning id`;
    if (backend === "database") {
      await sql`insert into file_blobs (file_id, content) values (${row.id}, ${input.bytes})`;
    }
    return { id: row.id, filename: input.filename, contentType: input.contentType, size: input.bytes.length };
  });
}

export async function readFileContent(fileId: string): Promise<{ bytes: Buffer; filename: string; contentType: string } | null> {
  const meta = await withService((sql) => sql<{ bucket: string; path: string; filename: string; content_type: string; storage_backend: string }[]>`
    select bucket, path, filename, content_type, storage_backend from files where id = ${fileId}`);
  const f = meta[0];
  if (!f) return null;
  if (f.storage_backend === "database") {
    const [blob] = await withService((sql) => sql<{ content: Buffer }[]>`select content from file_blobs where file_id = ${fileId}`);
    return blob ? { bytes: Buffer.from(blob.content), filename: f.filename, contentType: f.content_type } : null;
  }
  if (f.storage_backend === "disk") {
    const bytes = await readFile(path.join(process.cwd(), env().STORAGE_DISK_PATH, f.bucket, f.path));
    return { bytes, filename: f.filename, contentType: f.content_type };
  }
  const { data, error } = await supabaseAdmin().storage.from(f.bucket).download(f.path);
  if (error || !data) return null;
  return { bytes: Buffer.from(await data.arrayBuffer()), filename: f.filename, contentType: f.content_type };
}

/** Removes stored content; the `files` row is deleted by the caller (or cascades). */
export async function deleteFileContent(file: { bucket: string; path: string; storage_backend: string }) {
  if (file.storage_backend === "disk") {
    await rm(path.join(process.cwd(), env().STORAGE_DISK_PATH, file.bucket, file.path), { force: true });
  } else if (file.storage_backend === "supabase") {
    await supabaseAdmin().storage.from(file.bucket).remove([file.path]);
  }
}
