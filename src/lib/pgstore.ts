import {
  defaultSchema,
  defaultViews,
  sanitizeSchema,
  sanitizeViews,
  type Props,
} from './dbschema.ts';
import { BasePageStore, LEGACY_SPACE_ID, cleanSpace, type Page, type PageKind, type PageMeta, type Space, type UserProfile } from './storage.ts';

/** The one thing the store needs from a Postgres driver. Neon's HTTP driver and PGlite (tests) both fit. */
export interface Sql {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pages (
    id          text PRIMARY KEY,
    title       text NOT NULL,
    parent      text,
    icon        text NOT NULL DEFAULT '',
    ord         double precision NOT NULL DEFAULT 0,
    created_at  text NOT NULL,
    updated_at  text NOT NULL,
    kind        text NOT NULL DEFAULT 'page',
    database_id text,
    props       jsonb NOT NULL DEFAULT '{}',
    schema      jsonb,
    views       jsonb,
    body        text NOT NULL DEFAULT '',
    trashed_at  text
  )`,
  // Spaces (Phase 4). Older databases get the column added; pages without one belong to the legacy shared space.
  `ALTER TABLE pages ADD COLUMN IF NOT EXISTS space_id text`,
  `CREATE INDEX IF NOT EXISTS pages_space_idx ON pages (space_id) WHERE trashed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS spaces (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    icon       text NOT NULL DEFAULT '',
    kind       text NOT NULL,
    owner      text NOT NULL,
    members    jsonb NOT NULL DEFAULT '[]',
    created_at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    email      text PRIMARY KEY,
    name       text NOT NULL,
    updated_at text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS pages_database_idx ON pages (database_id) WHERE trashed_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages (parent) WHERE trashed_at IS NULL`,
];

const META_COLS = 'id, title, parent, icon, ord, created_at, updated_at, kind, database_id, props, schema, views, space_id';

function fromRow(r: any, withBody: boolean): Page {
  const kind: PageKind = r.kind === 'database' ? 'database' : 'page';
  const page: Page = {
    id: r.id,
    space: r.space_id || LEGACY_SPACE_ID,
    title: r.title,
    parent: r.parent ?? null,
    icon: r.icon ?? '',
    order: Number(r.ord),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    kind,
    database: r.database_id ?? null,
    props: (typeof r.props === 'string' ? JSON.parse(r.props) : r.props) as Props,
    body: withBody ? (r.body ?? '') : '',
  };
  if (kind === 'database') {
    try {
      const sc = typeof r.schema === 'string' ? JSON.parse(r.schema) : r.schema;
      const vw = typeof r.views === 'string' ? JSON.parse(r.views) : r.views;
      page.schema = sanitizeSchema(sc ?? []);
      page.views = sanitizeViews(vw ?? [], page.schema);
    } catch {
      page.schema = defaultSchema();
      page.views = defaultViews(page.schema);
    }
  }
  return page;
}

export class PgPageStore extends BasePageStore {
  private ready: Promise<Sql> | null = null;
  constructor(private connect: () => Promise<Sql>) {
    super();
  }

  /** Connects and creates the table on first use. */
  private db(): Promise<Sql> {
    if (!this.ready) {
      this.ready = (async () => {
        const sql = await this.connect();
        for (const stmt of SCHEMA) await sql.query(stmt);
        return sql;
      })().catch((e) => {
        this.ready = null; // try again next request
        throw e;
      });
    }
    return this.ready;
  }

  protected async readAll(): Promise<Page[]> {
    const { rows } = await (await this.db()).query(`SELECT ${META_COLS}, body FROM pages WHERE trashed_at IS NULL`);
    return rows.map((r) => fromRow(r, true));
  }

  protected async readMeta(): Promise<PageMeta[]> {
    const { rows } = await (await this.db()).query(`SELECT ${META_COLS} FROM pages WHERE trashed_at IS NULL`);
    return rows.map((r) => {
      const { body: _b, ...meta } = fromRow(r, false);
      return meta;
    });
  }

  protected async readOne(id: string): Promise<Page | null> {
    const { rows } = await (await this.db()).query(`SELECT ${META_COLS}, body FROM pages WHERE id = $1 AND trashed_at IS NULL`, [id]);
    return rows[0] ? fromRow(rows[0], true) : null;
  }

  protected async readRows(dbId: string): Promise<Page[]> {
    const { rows } = await (await this.db()).query(`SELECT ${META_COLS}, body FROM pages WHERE database_id = $1 AND trashed_at IS NULL`, [dbId]);
    return rows.map((r) => fromRow(r, true));
  }

  protected async candidates(q: string, spaces?: string[]): Promise<Page[]> {
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const sql = await this.db();
    const { rows } = spaces
      ? await sql.query(
          `SELECT ${META_COLS}, body FROM pages WHERE trashed_at IS NULL AND (title ILIKE $1 OR body ILIKE $1)
             AND COALESCE(space_id, $2) = ANY($3::text[]) LIMIT 200`,
          [like, LEGACY_SPACE_ID, spaces],
        )
      : await sql.query(`SELECT ${META_COLS}, body FROM pages WHERE trashed_at IS NULL AND (title ILIKE $1 OR body ILIKE $1) LIMIT 200`, [like]);
    return rows.map((r) => fromRow(r, true));
  }

  protected async write(p: Page, expectUpdatedAt?: string): Promise<boolean> {
    const sql = await this.db();
    const vals = [
      p.id,
      p.title,
      p.parent,
      p.icon,
      p.order,
      p.createdAt,
      p.updatedAt,
      p.kind,
      p.database,
      JSON.stringify(p.props ?? {}),
      p.kind === 'database' ? JSON.stringify(p.schema ?? []) : null,
      p.kind === 'database' ? JSON.stringify(p.views ?? []) : null,
      p.body,
      p.space,
    ];
    if (expectUpdatedAt !== undefined) {
      const r = await sql.query(
        `UPDATE pages SET title=$2, parent=$3, icon=$4, ord=$5, created_at=$6, updated_at=$7, kind=$8, database_id=$9,
           props=$10::jsonb, schema=$11::jsonb, views=$12::jsonb, body=$13, space_id=$14
         WHERE id=$1 AND updated_at=$15 AND trashed_at IS NULL`,
        [...vals, expectUpdatedAt],
      );
      if ((r.rowCount ?? 0) > 0) return true;
      // either the row doesn't exist yet (fine: insert below) or someone saved first
      const exists = await sql.query(`SELECT 1 FROM pages WHERE id=$1 AND trashed_at IS NULL`, [p.id]);
      if (exists.rows.length) return false;
    }
    await sql.query(
      `INSERT INTO pages (id, title, parent, icon, ord, created_at, updated_at, kind, database_id, props, schema, views, body, space_id, trashed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,NULL)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, parent=EXCLUDED.parent, icon=EXCLUDED.icon, ord=EXCLUDED.ord,
         created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at, kind=EXCLUDED.kind, database_id=EXCLUDED.database_id,
         props=EXCLUDED.props, schema=EXCLUDED.schema, views=EXCLUDED.views, body=EXCLUDED.body, space_id=EXCLUDED.space_id, trashed_at=NULL`,
      vals,
    );
    return true;
  }

  protected async trash(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await (await this.db()).query(`UPDATE pages SET trashed_at = $2 WHERE id = ANY($1::text[])`, [ids, new Date().toISOString()]);
  }

  private static toSpace(r: any): Space {
    const members = typeof r.members === 'string' ? JSON.parse(r.members) : r.members;
    return cleanSpace({ id: r.id, name: r.name, icon: r.icon, kind: r.kind, owner: r.owner, members: members ?? [], createdAt: r.created_at });
  }

  protected async readSpaces(): Promise<Space[]> {
    const { rows } = await (await this.db()).query(`SELECT id, name, icon, kind, owner, members, created_at FROM spaces ORDER BY created_at, id`);
    return rows.map(PgPageStore.toSpace);
  }

  protected async writeSpace(space: Space): Promise<void> {
    await (await this.db()).query(
      `INSERT INTO spaces (id, name, icon, kind, owner, members, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, icon=EXCLUDED.icon, kind=EXCLUDED.kind, owner=EXCLUDED.owner,
         members=EXCLUDED.members, created_at=EXCLUDED.created_at`,
      [space.id, space.name, space.icon, space.kind, space.owner, JSON.stringify(space.members), space.createdAt],
    );
  }

  protected async insertSpace(space: Space): Promise<boolean> {
    const r = await (await this.db()).query(
      `INSERT INTO spaces (id, name, icon, kind, owner, members, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [space.id, space.name, space.icon, space.kind, space.owner, JSON.stringify(space.members), space.createdAt],
    );
    return r.rows.length > 0;
  }

  protected async readUsers(): Promise<UserProfile[]> {
    const { rows } = await (await this.db()).query(`SELECT email, name FROM users ORDER BY email`);
    return rows.map((r) => ({ email: r.email, name: r.name }));
  }

  protected async writeUser(user: UserProfile): Promise<void> {
    await (await this.db()).query(
      `INSERT INTO users (email, name, updated_at) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
      [user.email, user.name, new Date().toISOString()],
    );
  }
}
