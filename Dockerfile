# Dapi's public demo: anyone signed in with GitHub can run a few jobs on reviewed public
# sources (DAPI_PUBLIC=1; limits in web/src/lib/server/quota.ts). Built on Playwright's
# own image, which carries Chromium for the investigation. Jobs live on a volume at
# /data/jobs; the finished demo jobs in this folder seed it on first start.
# Set DAPI_READ_ONLY=1 instead for a copy where nothing runs.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    DAPI_JOBS_DIR=/data/jobs
WORKDIR /app

# The pipeline's packages (it runs the jobs), then the web app's.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY web/package.json web/package-lock.json web/
# The build needs the web app's dev packages (Tailwind, TypeScript); NODE_ENV=production
# would otherwise make npm skip them.
RUN cd web && npm ci --include=dev

COPY . .
RUN cd web && npx next build

EXPOSE 3000
CMD ["sh", "deploy/start.sh"]
