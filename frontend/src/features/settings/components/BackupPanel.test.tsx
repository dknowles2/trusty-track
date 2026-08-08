import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertProvider } from '../../../context/AlertContext';
import * as backupClient from '../backupClient';
import BackupPanel from './BackupPanel';

function renderPanel() {
  return render(
    <AlertProvider>
      <BackupPanel />
    </AlertProvider>,
  );
}

async function chooseFile(name = 'backup.zip') {
  const input = screen.getByTestId('restore-file-input');
  await userEvent.upload(input, new File(['zip bytes'], name, { type: 'application/zip' }));
}

describe('BackupPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('downloads on demand', async () => {
    const download = vi.spyOn(backupClient, 'downloadBackup').mockResolvedValue();
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /download a backup/i }));

    expect(download).toHaveBeenCalled();
  });

  it('says why a download was refused', async () => {
    vi.spyOn(backupClient, 'downloadBackup').mockRejectedValue(
      new Error('Only the operator can download a backup.'),
    );
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /download a backup/i }));

    expect(
      await screen.findByText(/only the operator can download a backup/i),
    ).toBeInTheDocument();
  });

  it('asks before replacing anything, and names the file', async () => {
    const restore = vi.spyOn(backupClient, 'restoreBackup');
    renderPanel();

    await chooseFile('taken-at-nine.zip');

    expect(await screen.findByText(/taken-at-nine\.zip/)).toBeInTheDocument();
    expect(restore).not.toHaveBeenCalled();
  });

  it('does not restore when the operator backs out', async () => {
    // Choosing a file in a dialog is one misclick away from destroying the
    // event, so selection must only ever open the question.
    const restore = vi.spyOn(backupClient, 'restoreBackup');
    renderPanel();

    await chooseFile();
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    await waitFor(() => expect(restore).not.toHaveBeenCalled());
  });

  it('restores once the operator confirms', async () => {
    const restore = vi.spyOn(backupClient, 'restoreBackup').mockResolvedValue({
      createdAt: '2026-08-08T09:15:00+00:00',
      appVersion: '1.2.3',
      uploadCount: 4,
    });
    renderPanel();

    await chooseFile();
    await userEvent.click(
      await screen.findByRole('button', { name: /replace everything/i }),
    );

    await waitFor(() => expect(restore).toHaveBeenCalled());
    expect(await screen.findByText(/restored the backup taken/i)).toBeInTheDocument();
  });

  it('reports a refusal in the server’s own words', async () => {
    // "Taken from a newer version" is the whole value of that refusal.
    vi.spyOn(backupClient, 'restoreBackup').mockRejectedValue(
      new Error('This backup was taken from a newer version of Trusty Track'),
    );
    renderPanel();

    await chooseFile();
    await userEvent.click(
      await screen.findByRole('button', { name: /replace everything/i }),
    );

    expect(await screen.findByText(/newer version of Trusty Track/i)).toBeInTheDocument();
  });
});
