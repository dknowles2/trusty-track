# Development Guide

Welcome to the **Trusty Track** development guide! This document provides instructions on how to set up your environment, run the application locally, and execute tests.

## 🏗️ Project Overview

Trusty Track is a race management application built with:

- **Backend:** Python (FastAPI, SQLAlchemy, SQLite)
- **Frontend:** TypeScript (React, Vite, MUI/Tailwind)

## 📋 Prerequisites

Ensure you have the following installed:

- **Python 3.10+**
- **Node.js 18+** & **npm**
- **Git**

## 🔙 Backend Development

The backend is located in the `backend/` directory.

### 1. Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Running the Server

Start the development server with live reload:

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`.
Interactive API docs are at `http://localhost:8000/docs`.

### 3. Running Tests

Run the backend test suite using `pytest`:

```bash
# Run all tests
pytest

# Run tests with output
pytest -s

# Run a specific test file
pytest test_main.py
```

### 4. Database

The application uses **SQLite**. The database file `trusty-track.db` will be automatically created in the root directory upon first run.

## 🎨 Frontend Development

The frontend is located in the `frontend/` directory.

### 1. Setup

```bash
cd frontend
npm install
```

### 2. Running the UI

Start the Vite development server:

```bash
npm run dev
```

The application will be accessible at `http://localhost:5173`.

### 3. Running Tests

Run the frontend unit tests using `vitest`:

```bash
npm test
```

### 4. Linting

Check for code style issues:

```bash
npm run lint
```

## 🚀 Running the Full Stack

### Option 1: Convenience Script (Recommended)

You can start both the backend and frontend simultaneously using the provided helper script:

```bash
./scripts/run_dev.sh
```

### Option 2: Manual Start

To run the full application manually, you need two terminal windows:

**Terminal 1 (Backend):**

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

**Terminal 2 (Frontend):**

```bash
cd frontend
npm run dev
```

## 🐛 Troubleshooting

| Issue                     | Solution                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Port 8000/5173 in use** | Stop other running processes or allow the tools to pick the next available port (check console output).                                        |
| **CORS Errors**           | The backend is configured to allow `*` origins in development. Ensure you are accessing the frontend via `localhost` matching the CORS config. |
| **Database Locks**        | SQLite can occasionally lock if a process crashes. Restart the backend server.                                                                 |
| **Missing Dependencies**  | Re-run `pip install -r requirements.txt` (backend) or `npm install` (frontend).                                                                |

## 📁 Directory Structure

- `backend/` - API, database models, business logic.
- `frontend/` - React application, components, pages.
- `docs/` - Documentation files.
- `scripts/` - Utility scripts.
