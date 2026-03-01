Build the Band Availability web app described in AGENTS.md.

Please do the following in order:

1) Scaffold the React + Vite project (if not already present).
   - Ensure `npm run dev` works.

2) Add Supabase client setup:
   - Create `src/lib/supabaseClient.ts` (or .js) reading:
     - VITE_SUPABASE_URL
     - VITE_SUPABASE_ANON_KEY
   - Add example `.env.example`.

3) Implement Auth:
   - Login page/button for “Sign in with Google”
   - Handle callback route (e.g. /auth/callback)
   - Persist session and provide logout

4) Create data layer:
   - Functions to:
     - upsert member on login
     - fetch members
     - fetch availability for visible month
     - toggle availability for current user (insert/delete row)

5) Build calendar UI:
   - Month grid view with prev/next month
   - Each day cell shows two rows:
     - Day (9–15)
     - Evening (16–21)
   - For each block show:
     - Toggle for current user
     - Count like “X/Y”
     - Highlight when X == Y (everyone)

6) Add README:
   - Supabase SQL (members + availability) with constraints
   - RLS policies
   - Steps to enable Google auth and set redirect URLs
   - How to run locally + deploy to Vercel

Quality bar:
- Keep UI simple but usable.
- Don’t introduce heavy dependencies unless needed.
- Make sure code compiles and the app runs.