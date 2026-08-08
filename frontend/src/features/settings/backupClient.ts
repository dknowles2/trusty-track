/**
 * Talking to the backup endpoints (#176).
 *
 * REST rather than GraphQL, because one direction is a zip download and the
 * other is a file upload. Kept out of the component so the interesting parts —
 * the PIN header, the filename the browser saves under, and what a refusal
 * reads like — can be tested without rendering anything.
 */

import { pinHeaders } from '../../api/pin';

/** Where the endpoints live. The Vite dev proxy strips the `/api` prefix. */
const BACKUP_URL = '/api/backup';
const RESTORE_URL = '/api/backup/restore';

export interface RestoreResult {
  createdAt: string;
  appVersion: string;
  uploadCount: number;
}

/**
 * Pull the filename out of a `Content-Disposition` header.
 *
 * The server names the file after the moment the backup was taken, which is the
 * only thing that distinguishes one from another in a downloads folder. Falling
 * back to a fixed name would quietly turn a series of backups into
 * `backup (3).zip`, so the header is what we ask for and the fallback is only
 * for a proxy that strips it.
 */
export function filenameFrom(header: string | null): string {
  const match = header?.match(/filename="?([^";]+)"?/);
  return match ? match[1] : 'trusty-track-backup.zip';
}

/** The message to show when a response failed, preferring the server's own. */
async function reasonFor(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    // A non-JSON error body (a proxy's HTML page, say) tells the operator
    // nothing useful, so the caller's wording is better than showing it.
  }
  return fallback;
}

/**
 * Download the archive and hand it to the browser as a file.
 *
 * Fetched rather than linked. A plain `<a href>` cannot carry the PIN header,
 * and on an install with a PIN set the endpoint would refuse it — so the bytes
 * come back through `fetch` and are handed to a temporary object URL.
 */
export async function downloadBackup(): Promise<void> {
  const response = await fetch(BACKUP_URL, { headers: pinHeaders() });
  if (!response.ok) {
    throw new Error(
      await reasonFor(
        response,
        response.status === 403
          ? 'Only the operator can download a backup. Enter the operator PIN first.'
          : 'The backup could not be created.',
      ),
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filenameFrom(response.headers.get('Content-Disposition'));
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Send an archive back, replacing everything this install currently holds. */
export async function restoreBackup(file: File): Promise<RestoreResult> {
  const body = new FormData();
  body.append('file', file);

  const response = await fetch(RESTORE_URL, {
    method: 'POST',
    headers: pinHeaders(),
    body,
  });
  if (!response.ok) {
    throw new Error(
      await reasonFor(
        response,
        response.status === 403
          ? 'Only the operator can restore a backup. Enter the operator PIN first.'
          : 'That file could not be restored.',
      ),
    );
  }

  const result = await response.json();
  return {
    createdAt: result.created_at,
    appVersion: result.app_version,
    uploadCount: result.upload_count,
  };
}
