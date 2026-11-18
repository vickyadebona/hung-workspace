# Hung Workspace

A small, Notion-style workspace for two. Phase 1: nested pages, a block editor, search, light/dark mode that follows your system, Google sign-in. Every page is a plain Markdown file.

## Run it on your Mac

```bash
cd ~/code/hung-workspace
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
- `content/.spaces.json`: the list of spaces and who is in them. Each page file records its space in a `space:` line (files from before Phase 4 have none and count as TerraScape HQ).
- Nesting is stored as a `parent` id, so moving a page never renames files.
- A **database** is a page with `kind: database` plus its properties (`schema`) and saved views (`views`) in the frontmatter. Each **row** is its own page file with `database: <id>` and `props:` (values keyed by property id), so rows can hold full notes too. Select values store option ids, so renaming an option never breaks rows.

## Install it as a Mac app

Hung Workspace is an installable web app, so it can live in your Dock with its own window:

- **Chrome or Edge**: open the site, then the install icon in the address bar (or menu → Cast, save and share → Install Hung Workspace).
- **Safari (macOS Sonoma or newer)**: open the site, then File → Add to Dock.

It always shows the live site, so updates arrive by themselves. A menu-bar icon and a global shortcut need a small native wrapper (Electron or Tauri); that is a later, Mac-only step.

## Spaces and privacy (Phase 4)

Every page lives in exactly one **space**:

- **Personal**: each person gets a private space the first time they sign in. Only that person can see it.
- **Shared spaces**: a space with a member list, for a project or a team. The existing pages (the TerraScape HQ import, Welcome, test database) live in a shared space called **TerraScape HQ** that both of you belong to.

Use the space name at the top of the sidebar to switch. **New shared space** creates one; you become its owner and add people from **Settings → Spaces** (only emails already in `ALLOWED_EMAILS` can be added). Hover a page and use **⋯ → Move to space** to move it, with its sub-pages (a database moves with its rows). Search covers every space you belong to.

How it is enforced: every request goes through one access layer (`src/lib/access.ts`), so a page outside your spaces behaves exactly like a page that doesn't exist, whether you look it up, search for it, edit it, move it or export it. This is privacy **inside the app**: whoever holds the database or the files (you, as the person running it) could still read everything.

Backups leave **Personal spaces out on purpose**, so one person's private notes never land in someone else's backup folder. Each person can take their own copy from **Settings → Spaces → Export** (a `.tar.gz` of plain Markdown files).

## Databases (Phase 2)

Use **+ New database** in the sidebar. Each database has Table, Board, List and Calendar views with filters, sorting and properties (text, number, select, multi-select, date, checkbox, link). Board cards drag between columns (or use the "Move to" dropdown on a card, which also works on a phone). Calendar items drag between days. Rows don't appear in the sidebar; open one to get a full page with its properties on top. Edits to properties and views don't count as page edits, so they never trigger the "changed elsewhere" banner. Changes made by someone else show up when you switch back to the tab.

## Backups

Your pages live in `content/`, which git deliberately leaves out, so they are backed up separately. On this Mac a background job runs **every hour** and writes a compressed copy of every page to:

- `~/Backups/hung-workspace/` on this Mac, and
- `My Drive/Hung Workspace Backups/` in Google Drive (needs Google Drive for desktop; skipped if it isn't installed).

Nothing is written when no page has changed. It keeps every backup from the last 2 days, then the newest of each day for 30 days. Only **shared spaces** are included (never anyone's Personal space, and not the trash).

```bash
scripts/backup-schedule.sh install     # turn the hourly job on (already done on this Mac; needs Node 22)
scripts/backup-schedule.sh status      # is it running, and what did it last do
scripts/backup-schedule.sh uninstall   # turn it off (existing backups are kept)

npm run backup                         # make a backup right now
npm run backup -- list                 # see what backups exist
npm run backup -- restore ~/Backups/hung-workspace/<file>.tar.gz
```

`restore` unpacks into a **new** folder (`content-restored-<time>/`) and never overwrites your current pages; look it over, then swap it in for `content/`. Each backup is a plain archive of Markdown files, so you can also open one by double-clicking it.

Once the app runs online, your pages are in the database instead. Run `DATABASE_URL=... npm run backup` to back those up the same way (shared spaces only).

## Linked databases, people and nested pages (Phase 5)

In a database, **Properties → New property** now also offers:

- **Person**: pick people from the space's members (shown by name). Filter by person too.
- **Relation**: link rows to rows of another database in the same space (for example Tasks → Milestones). Leave "Also show on the other side" ticked and the other database gets a matching column that lists the rows pointing at it; you can edit the link from either side. "Only one linked row" is for things like a parent.
- **Rollup**: summarise the rows a relation points at: count, percent checked, percent with a status (e.g. Done), sum, average, smallest, largest, earliest or latest date. Rollups are worked out on the fly and are read-only; you can filter and sort on them.
- **Sub-items**: add a relation from a database to *itself* with "Only one linked row" (call it Parent) and the other side Sub-items. Then, in the view's **⋯** menu, choose "Nest under Parent" and the table or list shows sub-items indented under their parents, with a "+" to add one.

- **Formula**: a value worked out for each row from its other properties, for example `prop("Price") * prop("Quantity")` or `if(prop("Done"), "finished", "to do")` or `dateBetween(prop("Due"), today(), "days")`. Use `prop("Name")` for a property; combine with `+ - * / %`, compare with `== != < > <= >=`, and use `and` / `or` / `not`. There are functions for text (`concat`, `upper`, `lower`, `contains`, `replace`, `substring`, `join`, `length`), numbers (`round`, `floor`, `ceil`, `abs`, `min`, `max`, `sum`, `pow`, `sqrt`, `toNumber`) and dates (`today`, `date`, `dateAdd`, `dateSubtract`, `dateBetween`, `year`, `month`, `day`, `formatDate`). A formula can use rollups and formulas defined before it. It is checked as you type, and a formula that can't be worked out for a row just leaves that cell empty. Formulas run in a small interpreter (no code is ever executed), so they are safe to share.

In a table view you can **drag a column's right edge to resize it** (double-click the edge to reset it), and the view's **⋯** menu has **Wrap long text in cells**, which lets names and text fields run onto several lines instead of being cut off. Both are saved with that view.

Relations never cross spaces, and a database that is linked to another can't be moved to a different space on its own. Worked-out columns (the other side of a relation, rollups) are never stored in the files, so they can't go out of date.

For pages: every page shows a **breadcrumb** above its title. In the editor, type **/page** to create a page inside the current one; it appears right there in the text as a block with its icon and current name (rename the page and the block follows), and clicking it opens the page. In the file it is stored as a line holding just a link, `[📄 Title](/p/<id>)`. Deleting the block only removes the reference; the page stays in the sidebar, and any pages inside a page that aren't shown in its text (for example ones made with the sidebar's **+**) are listed under "Pages inside this page". (Putting a whole database inline in a page is not built yet.)

`npm run convert-hq` is a one-off that upgrades the TerraScape HQ databases to use all this: Tasks' plain-text Milestone becomes a real link to Milestones, Owner (Vicky / Andrew / Both) becomes a Person, and Milestones gain a task count and progress. It shows what it would do first; add `--apply` to do it. Back up first (`npm run backup -- --force`). To do the online copy, run it with `DATABASE_URL=... npm run convert-hq -- --apply`.

## My tasks

**My tasks** (in the sidebar, or `/my-tasks`) lists everything assigned to you across all the spaces you are in: rows of any database whose **Person** property includes you. Tasks are grouped Overdue, Today, Next 7 days, Later and No date; tick one to mark it done (it sets the database's Done status or checkbox). It works out each database's status, due date and priority from property names and types (a select called Status with an option like Done, a date called Due, a select called Priority). **Sources** lets you leave databases out (for example Milestones); that choice is remembered on this device. Type a task into the box at the top to add one for yourself: it goes into a **My tasks** database in your Personal space, created the first time, with you as Owner.

## How two people don't overwrite each other

There's no live co-editing yet. Each save carries the version it started from. If the page changed elsewhere in the meantime, saving pauses and a banner offers "Load latest", so nobody's work is silently lost.

## Tests

```bash
npm test          # storage, databases and sign-in logic
npx astro check   # types
```

## Not yet (planned)

A timeline view, comments and @mentions, row templates and recurring tasks, inline databases inside pages, Claude access (API/MCP), quick capture and bug list, drag-to-reorder, live co-editing, a hosted database for Vercel. Pages are stored through a `PageStore` interface (`src/lib/storage.ts`), so a database-backed store can replace the file store when it goes on Vercel.

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
