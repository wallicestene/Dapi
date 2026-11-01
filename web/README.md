# Dapi front door

The web app for Dapi: start a job from a spec, watch the agent work, approve the plan,
and explore the delivered rows with a receipt for every value.

It reads the job folders the runner writes (`../jobs`, or `DAPI_JOBS_DIR`) and loads
the pipeline modules in `../src` at run time. Keys stay in `../.env`.

```bash
npm install
npm run dev        # http://localhost:3000
```

`DAPI_READ_ONLY=1` serves finished jobs for exploring only: no new jobs, no runs.

Built with Next.js, shadcn/ui (Radix primitives, Tailwind) and lucide icons, restyled
to Dapi's own design (`../DESIGN.md`).
