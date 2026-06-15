FROM python:3.11-slim

WORKDIR /app

# System deps for google-auth, lxml, playwright, and audio processing.
# libasound2t64 is the Debian Bookworm name for libasound2 (renamed in 2023).
# libasound2 is kept as a fallback for older images that still use Bullseye.
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libxml2-dev libxslt-dev curl ffmpeg \
    # Playwright Chromium runtime dependencies
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 \
    && (apt-get install -y --no-install-recommends libasound2t64 || apt-get install -y --no-install-recommends libasound2 || true) \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir . && \
    playwright install chromium --with-deps

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
