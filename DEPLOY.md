# Deploying the public copy

The public copy is **read-only**: anyone can open the finished jobs in `jobs/`, their
data and their receipts, and nobody can start a job, so nothing runs on your Apify
account or your Meta credits. It's the `Dockerfile` in this folder with
`DAPI_READ_ONLY=1`, hosted on Fly.io (its deploy sends this folder, including the job
folders git leaves out).

What the copy shows is whatever finished jobs are in `jobs/` when you deploy. Remove a
job's folder first if it shouldn't be public. Receipts show only the fields a job
delivers, and the server checks seals itself; whole responses never leave it.

## Once

1. Install Fly's tool and sign in (a browser window opens). Fly may ask for a card,
   even for a small app.

   ```sh
   brew install flyctl
   fly auth login
   ```

2. Make an Apify token that can only read the evidence store. In Apify Console:
   **Settings > API & Integrations > Create new token**, turn on **Limit token
   permissions**, and give it **Read** on the key-value store `dapi-evidence` only.

3. Create the app from `fly.toml` (if the name `dapi` is taken, pick another), then
   give it the token and the store's ID:

   ```sh
   fly launch --no-deploy --copy-config
   fly secrets set APIFY_TOKEN=<the read-only token> DAPI_EVIDENCE_STORE=PasHMggEysnjfaBhS
   ```

## Each time

```sh
fly deploy
```

Then open `https://<app name>.fly.dev`. The machine stops when nobody is using it and
starts on the next visit (a few seconds, while the loading mark draws).

New jobs run on your own machine (`cd web && npm run dev`); deploy again to publish
them.
