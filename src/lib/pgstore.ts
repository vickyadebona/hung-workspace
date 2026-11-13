import {
  defaultSchema,
  defaultViews,
  sanitizeSchema,
  sanitizeViews,
  type Props,
} from './dbschema.ts';
import { BasePageStore, type Page, type PageKind, type PageMeta } from './storage.ts';

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
  `CREATE INDEX IF NOT EXISTS pages_database_idx ON pages (database_id) WHERE trashed_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages (parent) WHERE trashed_at IS NULL`,
];

const META_COLS = 'id, title, parent, icon, ord, created_at, updated_at, kind, database_id, props, schema, views';

function fromRow(r: any, withBody: boolean): Page {
  const kind: PageKind = r.kind === 'database' ? 'database' : 'page';
  const page: Page = {
    id: r.id,
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

  protected async candidates(q: string): Promise<Page[]> {
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const { rows } = await (await this.db()).query(
      `SELECT ${META_COLS}, body FROM pages WHERE trashed_at IS NULL AND (title ILIKE $1 OR body ILIKE $1) LIMIT 200`,
      [like],
    );
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
    ];
    if (expectUpdatedAt !== undefined) {
      const r = await sql.query(
        `UPDATE pages SET title=$2, parent=$3, icon=$4, ord=$5, created_at=$6, updated_at=$7, kind=$8, database_id=$9,
           props=$10::jsonb, schema=$11::jsonb, views=$12::jsonb, body=$13
         WHERE id=$1 AND updated_at=$14 AND trashed_at IS NULL`,
        [...vals, expectUpdatedAt],
      );
      if ((r.rowCount ?? 0) > 0) return true;
      // either the row doesn't exist yet (fine: insert below) or someone saved first
      const exists = await sql.query(`SELECT 1 FROM pages WHERE id=$1 AND trashed_at IS NULL`, [p.id]);
      if (exists.rows.length) return false;
    }
    await sql.query(
      `INSERT INTO pages (id, title, parent, icon, ord, created_at, updated_at, kind, database_id, props, schema, views, body, trashed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,NULL)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, parent=EXCLUDED.parent, icon=EXCLUDED.icon, ord=EXCLUDED.ord,
         created_at=EXCLUDED.created_at, updated_at=EXCLUDED.updated_at, kind=EXCLUDED.kind, database_id=EXCLUDED.database_id,
         props=EXCLUDED.props, schema=EXCLUDED.schema, views=EXCLUDED.views, body=EXCLUDED.body, trashed_at=NULL`,
      vals,
    );
    return true;
  }

  protected async trash(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await (await this.db()).query(`UPDATE pages SET trashed_at = $2 WHERE id = ANY($1::text[])`, [ids, new Date().toISOString()]);
  }
}
