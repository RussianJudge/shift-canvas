# Shift Canvas

Shift Canvas is a Next.js scheduling workspace for monthly crew planning. It is designed around multi-team operations where each employee follows a rotating 601-604 pattern and every working day needs a competency assignment such as `Post 1`, `Post 11`, or `Dock 7`.

## What is included

- A scheduling-focused React UI with sticky employee rows and one cell per day of the month
- Automatic 3 day / 3 night / 6 off rotation logic for `601`, `602`, `603`, and `604`
- Suggested competency assignments based on each employee's competency pool
- Local browser draft persistence so edits are not lost before the database is configured
- Supabase schema and seed data for teams, employees, competencies, and stored assignments
- Vercel-friendly Next.js app structure

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000)

## Supabase setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and fill in:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

3. Apply the schema and seed data:

   ```bash
   supabase db push
   psql "$SUPABASE_DB_URL" -f supabase/seed.sql
   ```

The UI falls back to demo data when Supabase is not configured. Saving assignments to the database requires `SUPABASE_SERVICE_ROLE_KEY` on the server.

## Deploy to Vercel

1. Create a Vercel project from this folder.
2. Add the same Supabase environment variables in Vercel.
3. Leave the Vercel `Output Directory` setting empty. Do not set it to `public` for this app.
4. Deploy a preview:

   ```bash
   vercel deploy -y --no-wait
   ```

If you want to productionize it next, the natural follow-ups are authentication, approval workflows, and exports to CSV or payroll systems.
