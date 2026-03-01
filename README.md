# Band Availability App

Small React + Vite app where members sign in with name + password (Supabase Auth), toggle daily availability in two blocks, and view overlap including when everyone is available.

## Tech stack

- React + Vite + TypeScript
- Supabase Auth + Postgres + RLS
- Static-friendly frontend (works with Vercel)

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

3. Start dev server:

```bash
npm run dev
```

4. Production build:

```bash
npm run build
```

## Supabase SQL (tables + constraints)

Run this in Supabase SQL Editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  time_block text not null check (time_block in ('day', 'evening')),
  created_at timestamptz not null default now(),
  unique (user_id, date, time_block)
);
```

## RLS policies

Enable RLS and create policies:

```sql
alter table public.members enable row level security;
alter table public.availability enable row level security;

drop policy if exists "members_select_authenticated" on public.members;
create policy "members_select_authenticated"
on public.members
for select
to authenticated
using (true);

drop policy if exists "members_insert_own" on public.members;
create policy "members_insert_own"
on public.members
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "members_update_own" on public.members;
create policy "members_update_own"
on public.members
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "availability_select_authenticated" on public.availability;
create policy "availability_select_authenticated"
on public.availability
for select
to authenticated
using (true);

drop policy if exists "availability_insert_own" on public.availability;
create policy "availability_insert_own"
on public.availability
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "availability_delete_own" on public.availability;
create policy "availability_delete_own"
on public.availability
for delete
to authenticated
using (user_id = auth.uid());
```

## Name + password auth setup in Supabase

1. In Supabase Dashboard, open `Authentication -> Providers -> Email`.
2. Enable Email provider.
3. For this app's simple login flow, turn off email confirmation:
- `Authentication -> Providers -> Email -> Confirm email` = Off
4. Users create accounts in the app using a name and password.

Notes:
- The app maps each name to an internal auth email format: `name@band.local`.
- Each member must always use the same name/password combination to log in.

## Deploy to Vercel

1. Push repo to GitHub.
2. Import project in Vercel.
3. Set environment variables in Vercel:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
4. Deploy.

No OAuth redirect URL setup is required for this name/password flow.

## Deploy to GitHub Pages

This repo is configured with a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.

1. Push your code to GitHub on branch `main`.
2. In GitHub repo settings, set `Settings -> Pages -> Source` to `GitHub Actions`.
3. Add these repo secrets in `Settings -> Secrets and variables -> Actions`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
4. Push to `main` (or run the workflow manually from the Actions tab).

Your site URL will be:
- `https://<your-github-username>.github.io/availabilityApp/`

Notes:
- `vite.config.ts` uses `base: '/availabilityApp/'` for this repository name.
- If you rename the repository, update the `base` value to match the new name.
