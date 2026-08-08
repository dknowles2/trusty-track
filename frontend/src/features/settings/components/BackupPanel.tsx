/**
 * Backing the event up and putting it back (#176).
 *
 * Outside the settings form on purpose, and for the same reason the timer-check
 * link is: this is something you do before and after an event, not a field you
 * save. Putting a Restore button inside a form whose submit button says "Save
 * Settings" invites exactly one kind of mistake.
 */

import { useRef, useState } from 'react';
import { useAlert } from '../../../context/AlertContext';
import { downloadBackup, restoreBackup } from '../backupClient';

export default function BackupPanel() {
  const { showConfirm, showToast } = useAlert();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);

  const handleDownload = async () => {
    setBusy('backup');
    try {
      await downloadBackup();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'The backup failed.',
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  const handleChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset the input straight away, so choosing the same file twice after a
    // cancelled confirmation still fires a change event.
    event.target.value = '';
    if (!file) return;

    // Choosing a file only asks. Restoring on selection would let a misclick in
    // a file dialog destroy the event.
    const confirmed = await showConfirm(
      `Everything currently in Trusty Track will be replaced by the contents of ${file.name} — every race, racer, result and photo. What is replaced is kept on this machine beside the restored copy, so a mistake can be undone by someone with access to it.`,
      'Restore this backup?',
      'Replace everything',
      'danger',
    );
    if (!confirmed) return;

    setBusy('restore');
    try {
      const result = await restoreBackup(file);
      showToast(
        `Restored the backup taken ${result.createdAt}. Reloading…`,
        'success',
      );
      // The whole dataset has been replaced, so every id the normalized cache
      // holds now describes a different event. Reloading is the same
      // heavy-handed-but-correct answer entering a PIN takes, for the same
      // reason: rebuilding the client and its cache in place is a great deal
      // more machinery for something that happens once.
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'The restore failed.',
        'error',
      );
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        marginTop: '2rem',
        padding: '1rem',
        border: '1px solid #ddd',
        borderRadius: '12px',
        background: '#f9f9f9',
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Backup</h2>
      <p style={{ color: '#666', fontSize: '0.9rem', marginTop: 0 }}>
        One file holding the whole event: every racer, every result and every photo.
        Worth taking once when check-in closes and once when the racing is over.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="primary-btn"
          onClick={handleDownload}
          disabled={busy !== null}
        >
          {busy === 'backup' ? 'Preparing…' : 'Download a backup'}
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => fileInput.current?.click()}
          disabled={busy !== null}
        >
          {busy === 'restore' ? 'Restoring…' : 'Restore from a backup…'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          onChange={handleChosen}
          style={{ display: 'none' }}
          data-testid="restore-file-input"
        />
      </div>
    </div>
  );
}
