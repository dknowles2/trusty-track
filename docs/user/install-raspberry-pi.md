# Installing on a Raspberry Pi

This guide turns a Raspberry Pi into a dedicated Trusty Track appliance. After a one-time setup, the app starts itself every time the Pi powers on — nothing to type, no terminal, on race day. The Pi runs headless, though: it has no desktop of its own, so you open Trusty Track from a browser on another device (a laptop, tablet, or phone) on the same network, the same as you would for any other install method.

---

## What you'll need

| Item | Notes |
|------|-------|
| **Raspberry Pi 4** (2 GB RAM or more) or **Raspberry Pi 5** | Pi 3B+ works but is slower |
| **MicroSD card** — 8 GB or larger (Class 10 / A1 recommended) | 16 GB gives comfortable headroom |
| **Power supply** | Official Raspberry Pi power supply for your model |
| **Network connection** | Ethernet cable (recommended) or Wi-Fi |
| **A second computer** | For flashing the SD card and SSH access |

---

## Step 1 — Flash Raspberry Pi OS

1. Download and install **[Raspberry Pi Imager](https://www.raspberrypi.com/software/)** on your computer.

2. Open Raspberry Pi Imager and click **Choose OS** → **Raspberry Pi OS (other)** → **Raspberry Pi OS Lite (64-bit)**.

3. Click **Choose Storage** and select your SD card.

4. Click the **gear icon** (⚙) to open advanced settings:
   - Enable **SSH** and set a username and password. Remember the username — you'll use it to connect in Step 2.
   - Optionally configure your Wi-Fi network (SSID and password).
   - Set the **hostname** to `trustytrack` (optional but recommended).

5. Click **Write** and wait for the process to complete.

6. Insert the SD card into your Raspberry Pi and power it on.

---

## Step 2 — Connect to the Pi

Wait about 60 seconds for the Pi to boot, then SSH into it from your computer, using the username you set in Step 1:

```bash
ssh <username>@trustytrack.local
# or use the IP address if mDNS doesn't work:
ssh <username>@<pi-ip-address>
```

You can find the Pi's IP address from your router's admin page, or by checking your network's device list.

---

## Step 3 — Run the install script

Paste this single command into the SSH terminal and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/dknowles2/trusty-track/main/scripts/install-pi.sh | sudo bash
```

The script will:
1. Install required software (Python, Node.js, Git).
2. Download Trusty Track.
3. Build the application (this takes **10–15 minutes** on first run).
4. Set up automatic startup on boot.
5. Generate a security certificate for HTTPS.

When it finishes, you'll see a message with the URL to access the app.

> **Tip:** You can also clone the repository and run `sudo ./scripts/install-pi.sh` if you prefer.

---

## Step 4 — Access the app

Once the install completes, open a browser on any device connected to the same network:

- **From another device:** `https://trustytrack.local:8000`
- **By IP address:** `https://<pi-ip-address>:8000`

This install has no screen or desktop of its own — a monitor plugged directly
into the Pi shows a plain login prompt, not the app. If you want a screen for
the audience (a projector, a TV, or a tablet at the track), point any other
device's browser at the app the same way; see [Recommended Display
Setups](../observation-displays.md#recommended-display-setups) for a few
common setups.

### Accepting the security certificate warning

Because the Pi uses a self-signed certificate (not from a commercial authority), your browser will show a security warning. This is normal and safe for a local network install.

**Chrome / Edge:**
1. Click **Advanced**
2. Click **Proceed to trustytrack.local (unsafe)**

**Firefox:**
1. Click **Advanced…**
2. Click **Accept the Risk and Continue**

**Safari:**
1. Click **Show Details**
2. Click **visit this website**
3. Click **Visit Website** in the dialog

You only need to do this once per device.

If the warning is a bigger problem for your event than losing the camera on a
second device — a shared tablet, say — you can skip the certificate entirely
and serve plain HTTP instead. See [HTTPS, certificates, and plain
HTTP](../reference/roles-and-permissions.md#https-certificates-and-plain-http).

---

## Keeping Trusty Track running

The service starts automatically when the Pi boots. You don't need to do anything on race day — just plug it in and wait about 30 seconds.

### Check service status

```bash
sudo systemctl status trustytrack
```

### View logs

```bash
sudo journalctl -u trustytrack -f
```

---

## Optional: Wi-Fi hotspot mode

If your venue doesn't have Wi-Fi, the Pi can broadcast its own network. During the install, you'll be asked:

```
Set up Wi-Fi hotspot mode? (recommended for venues without Wi-Fi) [y/N]
```

Type `y` and press Enter to set it up. The Pi will broadcast a network named **TrustyTrack**. Families and volunteers can connect to this network, then open `https://trustytrack.local:8000` in their browser.

> **Note:** When in hotspot mode, the Pi's Wi-Fi is used for the hotspot and cannot also connect to the internet.

---

## Updating Trusty Track

SSH into the Pi and run:

```bash
cd /opt/trustytrack
sudo git pull
sudo ./scripts/install-pi.sh
```

The script will update the software and restart the service.

---

## Troubleshooting

### Can't SSH into the Pi

- Make sure the Pi is powered on and connected to the network.
- Try using the IP address instead of `trustytrack.local`.
- Check that you enabled SSH during the imager setup step.

### Service not starting

```bash
sudo journalctl -u trustytrack -n 50
```

Look for error messages. Common causes: missing Python packages (re-run the install script), or the port is already in use.

### Can't reach the app from other devices

- Make sure the other device is on the same Wi-Fi network as the Pi (or connected to the TrustyTrack hotspot).
- Check the Pi's firewall: `sudo ufw status`
- Try accessing by IP address instead of `trustytrack.local`.

### Camera not working

Camera access requires HTTPS, which the Pi provides via its self-signed certificate. Make sure you've accepted the certificate warning in your browser (see Step 4 above).

If you deliberately turned HTTPS off (`TRUSTYTRACK_HTTP_ONLY`), this is expected on every device except the Pi itself — see [HTTPS, certificates, and plain HTTP](../reference/roles-and-permissions.md#https-certificates-and-plain-http).
