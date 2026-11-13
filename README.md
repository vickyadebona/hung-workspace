# Hung Workspace

A small, Notion-style workspace for two. Phase 1: nested pages, a block editor, search, light/dark mode that follows your system, Google sign-in. Every page is a plain Markdown file.

## Run it on your Mac

```bash
cd ~/code/own-notion
cp .env.example .env     # then edit .env (see below)
npm install
npm run build
npm start                # open http://localhost:4321
```

While developing, `npm run dev` gives instant reloads.

### Fill in `.env`

| Setting | What to put |
| --- | --- |
| `ALLOWED_EMAILS` | Your Gmail and Andrew's, comma-separated. Anyone else is refused. |
| `SESSION_SECRET` | Run `openssl rand -hex 32` and paste the result. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From Google (below). |
| `AUTH_DEV` | `1` skips Google for local testing only. Leave `0` once Google works. It never works over https. |
| `CONTENT_DIR` | Where pages are saved (default `./content`). |

### Google sign-in (one time, about 10 minutes)

1. Go to <https://console.cloud.google.com/> and create a project (for example "Hung Workspace").
2. APIs & Services, OAuth consent screen: choose External, fill in the app name and your email, and add you and Andrew as **test users**.
3. APIs & Services, Credentials, Create credentials, OAuth client ID, type **Web application**.
4. Authorised redirect URI: `http://localhost:4321/auth/callback` (add your Vercel address later, ending in `/auth/callback`).
5. Copy the client ID and secret into `.env`.

## Where your data lives

- `content/<id>.md`: one file per page, with title, parent and icon as frontmatter at the top. Open them in any editor.
- `content/.trash/`: deleted pages are moved here, not erased.
- Nesting is stored as a `parent` id, so moving a page never renames files.
- A **database** is a page with `kind: database` plus its properties (`schema`) and saved views (`views`) in the frontmatter. Each **row** is its own page file with `database: <id>` and `props:` (values keyed by property id), so rows can hold full notes too. Select values store option ids, so renaming an option never breaks rows.

## Databases (Phase 2)

Use **+ New database** in the sidebar. Each database has Table, Board, List and Calendar views with filters, sorting and properties (text, number, select, multi-select, date, checkbox, link). Board cards drag between columns (or use the "Move to" dropdown on a card, which also works on a phone). Calendar items drag between days. Rows don't appear in the sidebar; open one to get a full page with its properties on top. Edits to properties and views don't count as page edits, so they never trigger the "changed elsewhere" banner. Changes made by someone else show up when you switch back to the tab.

## How two people don't overwrite each other

There's no live co-editing yet. Each save carries the version it started from. If the page changed elsewhere in the meantime, saving pauses and a banner offers "Load latest", so nobody's work is silently lost.

## Tests

```bash
npm test          # storage, databases and sign-in logic
npx astro check   # types
```

## Not yet (planned)

Relations, rollups and formulas, Claude access (API/MCP), backups to Google Drive and Mac, quick capture and bug list, drag-to-reorder, live co-editing, a hosted database for Vercel. Pages are stored through a `PageStore` interface (`src/lib/storage.ts`), so a database-backed store can replace the file store when it goes on Vercel.

## Put it on Vercel (shared with Andrew)

Vercel has no permanent disk, so online the pages live in a Postgres database (Neon, free tier). The app picks the store by itself: `DATABASE_URL` set means Postgres, otherwise the `content/` folder.

1. Push this folder to a private GitHub repo and import it in Vercel (team TerraScape, free plan is fine).
2. In the Vercel project: Storage > Create > Neon (Postgres). This adds `DATABASE_URL` for you.
3. Add environment variables: `ALLOWED_EMAILS`, `SESSION_SECRET` (`openssl rand -hex 32`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_DEV=0`.
4. In Google Cloud Console add `https://<your-app>.vercel.app/auth/callback` as an authorised redirect URI.
5. Upload your local pages once: copy `DATABASE_URL` from Vercel into your shell and run `DATABASE_URL=... npm run store -- up`. Ids and timestamps are kept; pages with the same id are replaced.
6. Backup any time: `DATABASE_URL=... npm run store -- down --dir=backups/2026-11-12` writes everything back to Markdown files.

Never set `AUTH_DEV=1` online.

## TerraScape HQ import

`node --experimental-transform-types scripts/import-hq.ts scripts/hq-data.json` rebuilt the HQ workspace (Plan: Tasks, Milestones, Decisions, Content calendar; Records: Meeting log) from the Notion export. It is a one-off and only included so the import can be repeated or inspected. Finance tasks, milestones, decisions and any text about pricing, tax, costs or budgets were left out before import.
