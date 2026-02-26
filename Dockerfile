# Stage 1 — Build the React frontend
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# Stage 2 — Runtime image
FROM python:3.12-slim AS runtime

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Create a non-root user
RUN useradd --system --create-home --home-dir /home/trustytrack --shell /usr/sbin/nologin trustytrack

WORKDIR /app

# Install Python dependencies using uv
COPY pyproject.toml ./
COPY backend/ ./backend/
RUN uv pip install --system --no-cache .

# Copy the built frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Data directory — override with TRUSTYTRACK_DATA_DIR
ENV TRUSTYTRACK_DATA_DIR=/data
ENV PYTHONPATH=/app

# Expose the application port
EXPOSE 8000

# Switch to non-root user
USER trustytrack

CMD ["uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
