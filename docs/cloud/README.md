# Accounts and cloud islands

Sign-in, islands kept in the cloud, friends, and dropping in on a friend's
island while they play. The game talks to a [Supabase](https://supabase.com)
project for all of it, through a small client in `src/account/`. Until
`src/account/config.ts` names a project, none of this exists in the build: no
sign-in button, no request to anyone.

## Turning it on (the owner, once)

1. Go to <https://supabase.com>, sign in with GitHub, and create a project on
   the free plan. Name it `ccgame`; pick the region nearest your players
   (Singapore for Taiwan). Save the database password somewhere, though the
   game never needs it.
2. Open **SQL Editor → New query**, paste all of [`schema.sql`](schema.sql),
   and press **Run**. It should end with "Success. No rows returned".
3. Open **Authentication → Sign In / Providers → Email** and turn **Confirm
   email** off, then save. The free plan sends only a couple of emails an hour,
   so with it on, most sign-ups would wait on a confirmation that never comes.
4. Open **Authentication → URL Configuration** and set **Site URL** to
   `https://abiel990310.github.io/CCgame/`, so password-reset links come back
   to the game.
5. Open **Project Settings → API Keys** (or **Data API**) and copy two things:
   the **Project URL** (`https://<something>.supabase.co`) and the **anon /
   publishable** key. Both are public by design; the schema decides what they
   can do. Never share the `service_role` or secret key.
6. Paste the two into `LIVE_URL` and `LIVE_KEY` in `src/account/config.ts` and
   merge. The next deploy has accounts.

A free project pauses after a week without any requests, and unpauses from the
Supabase dashboard. Players keep playing the copies on their own devices while
it is paused.

## How it works

- **Accounts** are email and password through Supabase Auth. Each gets a
  profile with a unique name (3–16 letters, digits or `_`), which is what
  friends type to find each other.
- **The browser never touches a table.** Every call is one function in
  `schema.sql`, which checks who is signed in; the tables grant nothing to the
  browser roles. `cloud-live.test.ts` checks these rules against a real server.
- **A cloud island is the local slot, bundled.** `account/sync.ts` packs every
  localStorage entry `save.ts` writes for a slot into one text and unpacks it
  the same way, so the cloud copy needs no migration of its own: it loads
  through the same `loadWorld` as any other island.
- **One device plays a cloud island at a time.** Opening one takes its lease;
  the browser holding it refreshes it every 15 seconds and is the only one the
  server lets save. Opening it elsewhere asks whether to take it over, and the
  other device returns to its menu at its next heartbeat. Play is pushed every
  minute and on quit.
- **When two copies both moved on** (played offline on one device while the
  other pushed), the local one is kept as a separate island named
  "… (this device)", and the cloud copy is played. Nothing is overwritten.
- **Friends** are mutual: a request, then an accept. Asking someone who had
  already asked you makes you friends at once.
- **Dropping in**: the owner sets an island's *Who can drop in* to *My friends*
  in the pause menu. While they play it, co-op opens by itself and the room
  code goes to the server with the heartbeat; friends see the island in their
  menu under *Friends' islands* with a **Join** button. The join is ordinary
  co-op underneath, and the friend's character is kept on the island under
  their account rather than their browser, so it follows them between devices.
- Dropping in is signalled through the project's Realtime Broadcast, on
  public channels, before the public PeerJS broker is tried. Nothing is
  stored and no table is touched, but Realtime → Settings → "Allow public
  access" must stay on, or every join falls back to the public broker.
- Players who never sign in are untouched: islands stay on their device only.

## Testing against a local server

The real Supabase services run without Docker. Postgres 16, the
[PostgREST](https://github.com/PostgREST/postgrest/releases) static binary and
the [Supabase Auth](https://github.com/supabase/auth/releases) binary are
enough, with [`gateway.mjs`](gateway.mjs) standing in for Supabase's API
gateway on port 54321:

1. Start Postgres on 54322 and create Supabase's roles: `anon`,
   `authenticated`, `service_role` (all `nologin`), `authenticator` (login,
   granted the three), and `supabase_auth_admin` owning a schema `auth`. Grant
   `usage` on `public` and `auth` to the three browser roles.
2. Run `auth migrate` then `auth serve` with `GOTRUE_DB_DRIVER=postgres`,
   `DATABASE_URL=…?search_path=auth`, `GOTRUE_JWT_SECRET`, `PORT=9999`,
   `GOTRUE_MAILER_AUTOCONFIRM=true` and `API_EXTERNAL_URL`.
3. Apply `schema.sql`, then run PostgREST on 3000 against `authenticator`
   with `db-anon-role = "anon"` and the same JWT secret.
4. `node docs/cloud/gateway.mjs` (it also stands in for Realtime Broadcast,
   which is all the game uses of Realtime), and make an anon key: an HS256 JWT of
   `{"role":"anon"}` signed with the secret.
5. Schema tests: `CCGAME_CLOUD_URL=http://127.0.0.1:54321 CCGAME_CLOUD_KEY=<anon key> npx vitest run src/__tests__/cloud-live.test.ts`.
6. The game: build with `VITE_CLOUD_URL` and `VITE_CLOUD_KEY` set the same
   way, and `npm run preview`. For dropping in, also run a local PeerJS broker
   (`npx peerjs --port 9000`) and open the page with
   `?broker=ws%3A%2F%2F127.0.0.1%3A9000%2Fpeerjs%3Fkey%3Dpeerjs`.
