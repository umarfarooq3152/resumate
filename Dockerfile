FROM python:3.11-slim

WORKDIR /app

# System deps for google-auth, lxml, playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libxml2-dev libxslt-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

# Install playwright chromium for Rozee scraper (optional, skip on failure)
RUN playwright install chromium --with-deps 2>/dev/null || true

ENV PORT=8000
EXPOSE $PORT

CMD ["sh", "-c", "uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
