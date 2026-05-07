# Multi-stage Dockerfile for Scoring AI application
# Builds frontend static files and runs FastAPI backend

# Stage 1: Build frontend
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build static files
RUN npm run build

# Stage 2: Python backend
FROM python:3.12-slim

WORKDIR /app

# Install uv for fast dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy Python dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy application code
COPY *.py ./
COPY api/ ./api/
COPY prompts_config.json ./

# Copy built frontend from stage 1
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
