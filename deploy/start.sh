#!/bin/sh
# Seeds the jobs volume with the demo jobs (once each), then serves the app.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$DAPI_JOBS_DIR"
for job in "$root"/jobs/*/; do
  name=$(basename "$job")
  [ -e "$DAPI_JOBS_DIR/$name" ] || cp -r "$job" "$DAPI_JOBS_DIR/$name"
done
cd "$root/web"
exec npx next start -p "${PORT:-3000}"
