# Installing Trusty Track on macOS

This guide walks you through installing Trusty Track on a Mac. No terminal or technical knowledge required.

---

## Requirements

- macOS 12 (Monterey) or later
- About 200 MB of free disk space

---

## Step 1 — Download the installer

1. Go to the [Trusty Track Releases page](https://github.com/dknowles2/trusty-track/releases/latest) on GitHub.
2. Under **Assets**, click the `.dmg` file (for example, `TrustyTrack-1.0.0-mac.dmg`) to download it.

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

macOS may show a message like "TrustyTrack can't be opened because it is from an unidentified developer." This happens because the app hasn't been code-signed with an Apple certificate.

To open it anyway:

1. **Right-click** (or Control-click) on **TrustyTrack** in Applications.
2. Click **Open** from the menu.
3. Click **Open** again in the dialog that appears.

You only need to do this the first time you open the app.

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
