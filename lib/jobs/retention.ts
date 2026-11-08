import "server-only";
import { withService } from "@/lib/db";
import { deleteFileContent } from "@/lib/storage";

/**
 * GDPR storage limitation: applications that ended (rejected / withdrawn / declined) longer
 * ago than the cycle's retention period are anonymised - CV deleted, name and contact data
 * replaced, comments removed. Scores stay, so the statistics of past cycles remain valid.
 */
export async function runRetention(limit = 500) {
  const { done, files } = await withService(async (tx) => {
    const rows = await tx<{ application_id: string; file_id: string | null; bucket: string | null; path: string | null; storage_backend: string | null }[]>`
      select r.application_id, f.id as file_id, f.bucket, f.path, f.storage_backend
      from app.retention_candidates() r left join files f on f.id = r.cv_file_id
      limit ${limit}`;
    for (const r of rows) await tx`select app.anonymize_application(${r.application_id}, 'retention')`;
    if (rows.length) await tx`select app.log_event('gdpr.retention_run', 'system', null, ${tx.json({ anonymized: rows.length })})`;
    return { done: rows.length, files: rows.filter((r) => r.file_id && r.storage_backend !== "database") };
  });
  // delete stored CVs only after the database transaction committed (the rows are gone by now)
  for (const f of files) await deleteFileContent({ bucket: f.bucket!, path: f.path!, storage_backend: f.storage_backend! }).catch(() => {});
  return { anonymized: done };
}
