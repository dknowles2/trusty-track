# Backups

What is in a backup file, when a restore is refused, and how to undo one.
For the walkthrough, see [Backup and Restore](../backup-and-restore.md).

## What is in the file

A backup is a single zip:

- **`trusty-track.db`** — everything about every race: racers, dens, heats,
  results, settings, and the [activity log](roles-and-permissions.md#the-activity-log).
  It is captured safely even if the timer records a heat mid-backup.
- **`uploads/`** — the racer and car photographs. They travel with the
  results because the results alone would restore an event whose pictures
  were all missing.
- **`manifest.json`** — when the backup was taken and by which version.

The file is named for the moment it was taken.

## What a restore does

Restoring replaces **everything** currently in the app with the backup's
contents, then reloads the page. Every other screen — displays, the
check-in tablet — needs reloading too, since they are still showing the
event that was just replaced.

Nothing is touched unless the whole file checks out first, so a refusal
costs nothing.

## When a restore is refused

| Message | What it means |
| --- | --- |
| **Not a readable Trusty Track backup** | The file is damaged, or is not a backup — a photo, the wrong zip |
| **Taken from a newer version of Trusty Track** | The backup holds data this version does not understand yet. Update Trusty Track and try again |

A backup from an **older** version restores fine and is brought up to date
automatically — the same path an old database takes at startup.

## Undoing a restore

What was replaced is kept on the machine, beside the restored copy:

- `trusty-track.db.pre-restore`
- `uploads.pre-restore/`

Both are in the data folder (`~/.trustytrack` unless changed). Renaming
them back undoes the restore. Only the **most recent** restore is kept this
way: restore twice and the first copy is gone.

## Who can do it

Operator-only once [an operator PIN is set](roles-and-permissions.md) — a
backup holds every racer's name and photograph, and a restore replaces a
running event. With no PIN set, anyone on the network can do either, which
is one more reason to set one.
