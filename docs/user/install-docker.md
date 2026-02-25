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

## Installation

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

## Daily use

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

> **Note:** Camera features (photo capture) require HTTPS. For a local network install, see the [Raspberry Pi guide](install-raspberry-pi.md) which sets up HTTPS automatically.

---

## Troubleshooting

### Port 8000 is already in use

Change the host port in `docker-compose.yml`. For example, to use port 8080:

```yaml
ports:
  - "8080:8000"
```

Then access the app at `http://localhost:8080`.

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
