# Installing Trusty Track on Windows

This guide walks you through installing Trusty Track on a Windows PC. No terminal or technical knowledge required.

---

## Requirements

- Windows 10 or later (64-bit)
- About 200 MB of free disk space

---

## Step 1 — Download the installer

1. Go to the [Trusty Track Releases page](https://github.com/dknowles2/trusty-track/releases/latest) on GitHub.
2. Under **Assets**, click **TrustyTrack-\<version\>-setup.exe** to download it.

---

## Step 2 — Run the installer

Double-click the downloaded file to run it.

### If Windows Defender SmartScreen appears

Windows may show a blue screen saying "Windows protected your PC." This happens because the installer hasn't been signed with a paid certificate.

To continue:

1. Click **More info**.
2. Click **Run anyway**.

---

## Step 3 — Follow the installer wizard

1. Click **Next** on the welcome screen.
2. Choose an installation folder (the default is fine for most users). Trusty
   Track installs for **your user account only** and does not ask for an
   administrator password — useful on a school or church laptop you do not
   administer.
3. Optionally check **Create a Desktop shortcut**.
4. Click **Install**.
5. Click **Finish** — Trusty Track will launch automatically.

---

## Step 4 — Use Trusty Track

After installation, Trusty Track will open your browser to **[https://localhost:8000](https://localhost:8000)**. If it doesn't open within 30 seconds, open your browser and go to that address manually.

!!! warning "Your browser will warn you the first time"

    Trusty Track serves **https://** using a certificate it generates on your
    own machine. Browsers do not recognise it, so the first visit shows
    "Your connection is not private" or similar.

    Click **Advanced**, then **Proceed to localhost**. Nothing is leaving your
    machine — the certificate exists so that the camera and the barcode scanner
    work, which browsers only allow on a secure connection.


The first time you run it, you'll see a setup wizard to configure your organization and track.

---

## Starting Trusty Track later

- Double-click the **TrustyTrack** shortcut on your Desktop.
- Or click Start → search for **TrustyTrack** → click it.

---

## Quitting Trusty Track

Trusty Track runs in the background while open. To quit:

- Right-click the **TrustyTrack** icon in the system tray (bottom-right corner of your taskbar, near the clock).
- Click **Quit**.

> Your data is saved automatically. Quitting and reopening the app picks up where you left off.

---

## Where your data is stored

Trusty Track stores its database and photos in:

```
%APPDATA%\TrustyTrack\
```

To open this folder, press **Win+R**, type `%APPDATA%\TrustyTrack`, and press Enter.

---

## Updating

To update to a new version:

1. Download the new installer from the [Releases page](https://github.com/dknowles2/trusty-track/releases/latest).
2. Quit Trusty Track if it's running (system tray → Quit).
3. Run the new installer — it will replace the previous version while keeping your data.

---

## Uninstalling

1. Open **Settings** → **Apps** (or **Add or Remove Programs** on older Windows).
2. Search for **TrustyTrack**.
3. Click **Uninstall** and follow the prompts.

Your data folder (`%APPDATA%\TrustyTrack\`) is not deleted by the uninstaller. Delete it manually if you want to remove all data.

---

## Troubleshooting

### Other devices cannot reach the app

The first time Trusty Track starts, Windows Firewall asks whether to allow it
on the network. Answer **Allow** — the audience displays and any second
operator connect over your local network, and blocking it leaves the app
working only on the machine it is installed on.

If you dismissed that prompt, re-allow it in **Settings → Privacy & security →
Windows Security → Firewall & network protection → Allow an app through
firewall**.

### "Windows cannot find the file" after install

Make sure the installation completed without errors. Try re-running the installer.

### App starts but browser doesn't open

Go to `https://localhost:8000` in your browser manually — note the **https**.

### Antivirus flags the installer

The installer is safe, but unsigned — some antivirus software may flag unsigned executables. You can:
- Add an exception for the installer file.
- Download the installer again and verify the file size matches the Releases page.
- [Run from source](install-from-source.md) if your organization's security policy prevents running unsigned software.

### App starts but shows an error page

Check that nothing else is using port 8000. If so, the app cannot start. Quit other applications that might use that port and try again.
