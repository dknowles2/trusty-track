# Installing Trusty Track on macOS

This guide walks you through installing Trusty Track on a Mac. No terminal or technical knowledge required.

---

## Requirements

- macOS 12 (Monterey) or later
- About 200 MB of free disk space

---

## Step 1 — Download the installer

[Download for macOS](https://github.com/dknowles2/trusty-track/releases/latest/download/TrustyTrack-mac.dmg){ .md-button .md-button--primary }

Prefer to pick a specific version, or check a file's checksum? The
[Trusty Track Releases page](https://github.com/dknowles2/trusty-track/releases/latest)
on GitHub lists every release, each with its own copy of the installer.

---

## Step 2 — Install the app

1. Open the downloaded `.dmg` file (double-click it in your Downloads folder).
2. A window appears showing the Trusty Track icon and an Applications folder shortcut.
3. Drag the **TrustyTrack** icon onto the **Applications** folder.
4. Wait for the copy to finish, then eject the disk image (drag it to the Trash or press ⌘E).

---

## Step 3 — Open Trusty Track

Open your **Applications** folder (click Go → Applications in the Finder menu bar), then double-click **TrustyTrack**.

### If you see a Gatekeeper security warning

macOS may show a message like "TrustyTrack can't be opened because it is from an unidentified developer" or "Apple could not verify TrustyTrack is free of malware." This happens because the app hasn't been code-signed with an Apple certificate.

How to open it anyway depends on your macOS version — check the Apple menu → **About This Mac** if you're not sure which you have.

**macOS 12 (Monterey) through 14 (Sonoma):**

1. **Right-click** (or Control-click) on **TrustyTrack** in Applications.
2. Click **Open** from the menu.
3. Click **Open** again in the dialog that appears.

**macOS 15 (Sequoia) and later:**

Sequoia removed the right-click bypass, so use System Settings instead:

1. Try to open **TrustyTrack** and dismiss the warning.
2. Open **System Settings**.
3. Go to **Privacy & Security**, then scroll down to the **Security** section.
4. Next to the message about TrustyTrack, click **Open Anyway**.
5. Confirm in the dialog that appears, and enter your admin password if asked.

You only need to do this the first time you open the app.

### If macOS says the app is "damaged"

If the message is **"TrustyTrack is damaged and can't be opened. You should
move it to the Trash"**, the app is not damaged and there is nothing wrong with
your download. Version 1.1.1 was built in a way macOS reads as tampered-with,
and that particular refusal has no **Open Anyway** button, so the steps above
will not help.

Later versions do not have this problem, so the easiest fix is to
[download the current version](https://github.com/dknowles2/trusty-track/releases/latest)
and install it over the top.

To keep the copy you have, open **Terminal** (in Applications → Utilities) and
paste this line, then press Return:

```bash
xattr -dr com.apple.quarantine /Applications/TrustyTrack.app
```

That clears the "downloaded from the internet" flag macOS attaches to the app,
which is what triggers the check. You may be asked for your password. Open the
app normally afterwards.


---

## Step 4 — Use Trusty Track

After opening the app, your browser will automatically open to **[https://localhost:8000](https://localhost:8000)**. If it doesn't open within 30 seconds, open your browser and go to that address manually.

!!! warning "Your browser will warn you the first time"

    Trusty Track serves **https://** using a certificate it generates on your
    own machine. Browsers do not recognise it, so the first visit shows
    "Your connection is not private" or similar.

    Click **Advanced**, then **Proceed to localhost**. Nothing is leaving your
    machine — the certificate exists so that the camera and the barcode scanner
    work, which browsers only allow on a secure connection.


The first time you run it, you'll see a setup wizard to configure your organization and track.

---

## Quitting Trusty Track

Trusty Track runs as a background process while open. To quit it:

- Find the **TrustyTrack** icon in your Dock, right-click it, and choose **Quit**.
- Or press ⌘Q while the app is focused.
- Or open Activity Monitor, find "trustytrack", and click the ✕ button.

> Your data is saved automatically. Quitting and reopening the app picks up where you left off.

---

## Where your data is stored

Trusty Track stores its data and photos in:

```
~/Library/Application Support/TrustyTrack/
```

To open this folder in Finder, press ⌘⇧G and paste that path.

---

## Updating

To update to a new version:

1. Download the new `.dmg` from the [Releases page](https://github.com/dknowles2/trusty-track/releases/latest).
2. Quit Trusty Track if it's running.
3. Open the new `.dmg` and drag **TrustyTrack** to Applications, replacing the old version.

---

## Troubleshooting

### App bounces in the Dock and doesn't open

The app may be failing to start. Try:
1. Open **Terminal** (search for it in Spotlight).
2. Run: `/Applications/TrustyTrack.app/Contents/MacOS/TrustyTrack`
3. Look for error messages.

### Browser doesn't open automatically

Go to `https://localhost:8000` in your browser manually — note the **https**.

### App crashes on startup

Quit the app, then delete the data directory and try again:

```bash
rm -rf ~/Library/Application\ Support/TrustyTrack
```

> This will delete all your race data. Only do this if you're setting up for the first time and don't have data to keep.
