# The public, read-only copy of Dapi: the finished jobs in jobs/ and their receipts.
# Nothing can start a job here (DAPI_READ_ONLY=1), so no Meta key is needed, and the
# Apify token it's given only has to read the dapi-evidence store.
FROM node:22-slim
ENV NODE_ENV=production \
    DAPI_READ_ONLY=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

# The pipeline's packages (the receipts and rows are read with its own code), then the web app's.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci

COPY . .
RUN cd web && npx next build

EXPOSE 3000
CMD ["sh", "-c", "cd web && exec npx next start -p ${PORT:-3000}"]
