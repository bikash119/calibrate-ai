# Multi-stage Dockerfile for Calibrate AI.
# Builds the frontend static bundle, then bakes both halves into one image.

# Stage 1: Build frontend
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend
FROM python:3.12-slim

WORKDIR /app

# uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Python deps first (better cache reuse than copying source first)
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

# Backend source — flatten into /app so api.main:app resolves the same way
# at runtime as it does in dev.
COPY backend/*.py ./
COPY backend/api/ ./api/

# Built frontend from stage 1; FastAPI serves these at runtime.
COPY --from=frontend-builder /app/frontend/dist ./static

# Create data directory for SQLite
RUN mkdir -p /data

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV SCORING_DB_PATH=/data/scoring.db

# Expose port
EXPOSE 8000

# Copy entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Seed the database, optionally load applications, then run the application
ENTRYPOINT ["./entrypoint.sh"]
