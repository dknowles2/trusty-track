# Stage 1 — Build the React frontend
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# Stage 2 — Runtime image
FROM python:3.11-slim AS runtime

# Create a non-root user
RUN useradd --system --create-home --home-dir /home/trustytrack --shell /usr/sbin/nologin trustytrack

WORKDIR /app/backend

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# Copy the built frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Data directory — override with TRUSTYTRACK_DATA_DIR
ENV TRUSTYTRACK_DATA_DIR=/data

# Expose the application port
EXPOSE 8000

# Switch to non-root user
USER trustytrack

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
