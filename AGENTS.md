# AGENTS.md — Band Availability App

## Goal
Build a small web app where band members log in with Google (Supabase Auth), mark their availability for each day in two time blocks:
- 9:00–15:00 ("day")
- 16:00–21:00 ("evening")
Show a calendar-like view that highlights where **everyone** is available.

## Tech decisions
- Frontend: React + Vite
- Backend: Supabase (Auth + Postgres + RLS)
- No custom server required. Frontend talks to Supabase via @supabase/supabase-js.
- Host frontend on Vercel or GitHub Pages later (keep it static-friendly).

## Repo expectations
- Use TypeScript if the project is TS; otherwise JS is fine, but be consistent.
- Keep code simple and readable.
- Use environment variables, never hardcode keys.

## Commands
- Install: npm install
- Dev: npm run dev
- Build: npm run build
- Lint (if configured): npm run lint

## Product requirements
### Auth
- Google OAuth via Supabase Auth.
- After login, show the user’s display name + a logout button.

### Data model
Create a table `availability`:
- id (uuid, pk, default gen_random_uuid())
- user_id (uuid, not null)
- date (date, not null)
- time_block (text, not null, enum-like: 'day' or 'evening')
- created_at (timestamptz, default now())

Unique constraint:
- (user_id, date, time_block) unique

### Security (RLS)
- Enable RLS on `availability`.
- Policies:
  - SELECT: authenticated users can read all rows (so everyone can see overlaps).
  - INSERT: authenticated users can insert only rows where user_id = auth.uid().
  - DELETE: authenticated users can delete only their own rows.
  - UPDATE: optional; easiest is no update, use insert/delete toggles.

### UI requirements
- Calendar-ish monthly view:
  - Shows current month grid (simple month calendar ok).
  - Each day cell shows two toggle rows: Day and Evening.
  - If user is logged in, they can toggle their own availability for that day/time block.
- Highlighting:
  - If **all** members (registered users who have any row in the month OR a members table if implemented) are available for a given date+block, show a strong highlight.
  - Also show partial overlap counts like “3/5 available” per block.

### Definition of “everyone”
Implement a `members` table to define who counts:
- `members`: user_id (uuid pk), display_name (text), created_at
- On first login, upsert the user into `members`.
Then “everyone” = all rows in `members`.

### Error handling
- Friendly messages if Supabase env vars are missing.
- Loading states for auth + data fetch.

## Deliverables
- Working app in this repo.
- A README with:
  - Setup steps (Supabase project, env vars)
  - How to enable Google provider + redirect URLs
  - SQL for tables + RLS policies
  - How to run locally and deploy (Vercel recommended)