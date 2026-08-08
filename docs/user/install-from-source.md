# Installing from Source

This guide is for developers and advanced users who want to run Trusty Track by cloning the repository and building it locally.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Python 3.10 or higher**
- **Node.js 22 or higher**
- **Git**

## Installation Steps

1. **Clone the repository:**

   ```bash
   git clone https://github.com/dknowles2/trusty-track.git
   cd trusty-track
   ```

2. **Run the installation script:**
   This script will create a Python virtual environment, install backend dependencies, and build the React frontend.
   ```bash
   ./scripts/install.sh
   ```

## Running the Application

Once installed, you can start the application with a single command:

```bash
./scripts/serve.sh
```

The application will be available at [http://localhost:8005](http://localhost:8005).

## Configuration

You can customize where Trusty Track stores its data (database and uploads) using environment variables:

- `TRUSTYTRACK_DATA_DIR`: Set this to the directory where you want data stored. Default is `~/.trustytrack`.
- `TRUSTYTRACK_DB_URL`: (Optional) Provide a full SQLAlchemy database URL to override the default SQLite location.

Example:

```bash
TRUSTYTRACK_DATA_DIR=/opt/trusty-data ./scripts/serve.sh
```

## Health Check

You can verify that the server is running by visiting the health check endpoint:
[http://localhost:8005/health](http://localhost:8005/health)
