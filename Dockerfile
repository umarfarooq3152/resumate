FROM python:3.11-slim

WORKDIR /app

# System deps for google-auth, lxml, playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libxml2-dev libxslt-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[api]" 2>/dev/null || pip install --no-cache-dir -e .

# Install playwright chromium for Rozee scraper (optional, skip on failure)
RUN playwright install chromium --with-deps 2>/dev/null || true

COPY src/ ./src/

ENV PORT=8000
EXPOSE 8000

CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
