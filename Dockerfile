FROM python:3.11-slim

WORKDIR /app

# Minimal system deps: lxml parsing + curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libxml2-dev libxslt-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src/ ./src/
# Install without triggering playwright browser download
RUN pip install --no-cache-dir . \
    && playwright install-deps chromium 2>/dev/null || true

EXPOSE 8080

CMD ["sh", "-c", "uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
