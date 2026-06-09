FROM node:20-slim

# Chromium deps for whatsapp-web.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=3001
EXPOSE 3001
CMD ["sh", "-c", "PORT=${PORT:-3001} node index.js"]
