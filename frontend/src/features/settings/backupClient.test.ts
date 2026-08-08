import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIN_HEADER, clearPin, writePin } from '../../api/pin';
import { downloadBackup, filenameFrom, restoreBackup } from './backupClient';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('naming the downloaded file', () => {
  it('takes the name the server chose', () => {
    // The server names it after the moment the backup was taken, which is the
    // only thing distinguishing one from another in a downloads folder.
    expect(
      filenameFrom('attachment; filename="trusty-track-backup-20260808T091500.zip"'),
    ).toBe('trusty-track-backup-20260808T091500.zip');
  });

  it('copes with an unquoted filename', () => {
    expect(filenameFrom('attachment; filename=backup.zip')).toBe('backup.zip');
  });

  it('falls back when a proxy strips the header', () => {
    expect(filenameFrom(null)).toBe('trusty-track-backup.zip');
  });
});

describe('downloading a backup', () => {
  beforeEach(() => {
    clearPin();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearPin();
  });

  it('carries the PIN, which a plain link could not', async () => {
    // The reason this goes through fetch at all: an `<a href>` cannot set a
    // header, so on an install with a PIN set a link would be refused.
    writePin('1234');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['zip bytes'])));

    await downloadBackup();

    expect(fetchSpy).toHaveBeenCalledWith('/api/backup', {
      headers: { [PIN_HEADER]: '1234' },
    });
  });

  it('hands the bytes to the browser as a named file', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['zip bytes']), {
        headers: { 'Content-Disposition': 'attachment; filename="taken-at-nine.zip"' },
      }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadBackup();

    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('explains a refusal in terms of the PIN', async () => {
    // A viewer clicking this needs to know what to do about it, not the status
    // code.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ detail: 'Operator PIN required' }, 403),
    );
    await expect(downloadBackup()).rejects.toThrow('Operator PIN required');
  });
});

describe('restoring a backup', () => {
  beforeEach(() => clearPin());
  afterEach(() => {
    vi.restoreAllMocks();
    clearPin();
  });

  it('sends the file with the PIN', async () => {
    writePin('1234');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        restored: true,
        created_at: '2026-08-08T09:15:00+00:00',
        app_version: '1.2.3',
        upload_count: 4,
      }),
    );

    const result = await restoreBackup(new File(['zip'], 'backup.zip'));

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/backup/restore');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ [PIN_HEADER]: '1234' });
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
    expect(result).toEqual({
      createdAt: '2026-08-08T09:15:00+00:00',
      appVersion: '1.2.3',
      uploadCount: 4,
    });
  });

  it("passes the server's reason through", async () => {
    // "This backup was taken from a newer version" is the whole value of the
    // refusal; replacing it with a generic message throws that away.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { detail: 'This backup was taken from a newer version of Trusty Track' },
        400,
      ),
    );
    await expect(restoreBackup(new File(['zip'], 'backup.zip'))).rejects.toThrow(
      'newer version of Trusty Track',
    );
  });

  it('falls back to its own wording when the body is not JSON', async () => {
    // A proxy's HTML error page tells the operator nothing.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>502</html>', { status: 502 }),
    );
    await expect(restoreBackup(new File(['zip'], 'backup.zip'))).rejects.toThrow(
      'That file could not be restored.',
    );
  });
});
