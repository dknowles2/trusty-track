# Installing with Docker

This guide walks you through running Trusty Track using Docker Compose. Docker lets you run the app in an isolated container without installing Python or Node.js on your machine.

---

## Prerequisites

- **Docker Desktop** (Mac or Windows) — [download here](https://www.docker.com/products/docker-desktop/)
- **Docker Engine** (Linux) — install with your package manager

Verify Docker is installed by opening a terminal and running:

```bash
docker --version
```

---

## Two ways to run it

**Docker Compose** keeps the settings in a file you can edit and check into
version control, and gives you one command to start and stop. Use it if the
machine is going to keep running Trusty Track.

**A single `docker run`** needs no files at all. Use it to try the app, or on a
machine you are borrowing for the day.

Both use the same image and the same data volume, so you can start with one and
switch to the other later.

---

## Option A — Docker Compose

### Step 1 — Create a `docker-compose.yml` file

Create a new folder somewhere on your computer (for example, `trustytrack/`), then create a file inside it called `docker-compose.yml` with the following contents:

```yaml
services:
  app:
    image: ghcr.io/dknowles2/trusty-track:latest
    ports:
      - "8000:8000"
    volumes:
      - trustytrack_data:/data
    environment:
      - TRUSTYTRACK_DATA_DIR=/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

volumes:
  trustytrack_data:
```

### Step 2 — Start Trusty Track

Open a terminal, navigate to the folder containing your `docker-compose.yml`, and run:

```bash
docker compose up -d
```

Docker will download the Trusty Track image (about 200 MB on first run) and start the application in the background.

### Step 3 — Open the app

Open your browser and go to:

**[http://localhost:8000](http://localhost:8000)**

The app will open to the first-run setup wizard.

---

## Option B — A single `docker run`

One command, no files:

```bash
docker run -d --name trustytrack -p 8000:8000 -v trustytrack_data:/data --restart unless-stopped ghcr.io/dknowles2/trusty-track:latest
```

Then open **[http://localhost:8000](http://localhost:8000)**.

What each part does:

| Part | Why |
| --- | --- |
| `-d` | Runs in the background. Drop it to watch the logs in your terminal. |
| `--name trustytrack` | Lets you say `docker stop trustytrack` instead of hunting for an id. |
| `-p 8000:8000` | Publishes the app on port 8000. Use `-p 9000:8000` if something else has 8000. |
| `-v trustytrack_data:/data` | **Keeps your race data.** Without it, everything is deleted when the container is removed. |
| `--restart unless-stopped` | Comes back after a reboot — worth having on the machine running the event. |

!!! warning "Do not skip the `-v`"

    A container without a volume loses its database the moment it is removed,
    including by `docker rm` or a `docker run` of a newer version. The volume is
    what makes an update safe.

### Daily use with `docker run`

```bash
docker stop trustytrack
```

```bash
docker start trustytrack
```

```bash
docker logs -f trustytrack
```

Updating means replacing the container. The volume survives, so your data does:

```bash
docker pull ghcr.io/dknowles2/trusty-track:latest
docker stop trustytrack && docker rm trustytrack
docker run -d --name trustytrack -p 8000:8000 -v trustytrack_data:/data --restart unless-stopped ghcr.io/dknowles2/trusty-track:latest
```

---

## Daily use with Compose

### Stop the app

```bash
docker compose down
```

### Start again

```bash
docker compose up -d
```

### Check if it's running

```bash
docker compose ps
```

### Update to the latest version

```bash
docker compose pull
docker compose up -d
```

---

## Where your data is stored

Trusty Track stores its database and uploaded photos in a Docker **named volume** called `trustytrack_data`. This data persists across stops, starts, and updates.

To find where Docker stores the volume on your machine:

```bash
docker volume inspect trustytrack_data
```

### Backing up your data

```bash
docker run --rm \
  -v trustytrack_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/trustytrack-backup.tar.gz -C /data .
```

This creates a `trustytrack-backup.tar.gz` file in the current directory.

---

## Accessing from other devices on your network

By default, Trusty Track is available at `http://localhost:8000` on the computer running Docker. To allow other devices (tablets, phones, laptops) to connect:

1. Find your computer's local IP address:
   - **Mac:** System Settings → Wi-Fi → Details → IP Address
   - **Windows:** Run `ipconfig` in a terminal, look for `IPv4 Address`
   - **Linux:** Run `ip addr`
2. Other devices can then open `http://<your-ip>:8000` in a browser.

!!! note "Camera features need HTTPS away from the host machine"

    The Docker image serves plain HTTP. Browsers allow the camera on
    `localhost` regardless, so **photo capture and the [check-in
    scanner](../printables.md#scanning-at-check-in) work on the machine running
    Docker** — but not on a tablet or phone reaching it by IP address, where the
    browser will refuse to open the camera.

    Everything else — the roster, race control, the audience displays — works
    over HTTP from any device.

    If you need the camera on a second device, the [Raspberry Pi
    guide](install-raspberry-pi.md) generates a self-signed certificate and
    serves HTTPS, and so does the [macOS](install-mac.md) or
    [Windows](install-windows.md) desktop app — see [HTTPS, certificates, and
    plain HTTP](../reference/roles-and-permissions.md#https-certificates-and-plain-http)
    for the tradeoff either way.

---

## Troubleshooting

### Port 8000 is already in use

Change the host port in `docker-compose.yml`. For example, to use port 8080:

```yaml
ports:
  - "8080:8000"
```

Then access the app at `http://localhost:8080`.

### "Permission denied: '/data'" in the logs

You are running an image built before August 2026. It created no `/data`
directory, and the app cannot write one as its non-root user. Pull a newer
image:

```bash
docker pull ghcr.io/dknowles2/trusty-track:latest
```

### Container exits immediately

Check the container logs:

```bash
docker compose logs app
```

### Health check failing

Wait up to 30 seconds for the container to start. If it still fails:

```bash
docker compose logs app
```

Look for error messages about missing files or database issues.

### Can't reach the app from another device

- Make sure the other device is on the same Wi-Fi network.
- Check that your computer's firewall allows incoming connections on port 8000.
- Try temporarily disabling the firewall to test.
