import type { APIRoute } from 'astro';
import { workspaceFor } from '../../../../lib/workspace';
import { fail } from '../../../../lib/http';
import { pageToMarkdown } from '../../../../lib/storage';
import { tarGz } from '../../../../lib/tar';

/** Download every page in a space you belong to as a .tar.gz of plain Markdown files (the same files the app stores). */
export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const ws = workspaceFor(locals.user);
    const space = await ws.space(params.id ?? '');
    const pages = await ws.pagesOf(space.id);
    const files = [
      { name: '.spaces.json', data: JSON.stringify([space], null, 2) + '\n' },
      ...pages.map((p) => ({ name: `${p.id}.md`, data: pageToMarkdown(p), mtime: new Date(p.updatedAt) })),
    ];
    const slug = space.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'space';
    const day = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(tarGz(files)), {
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="hung-workspace-${slug}-${day}.tar.gz"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return fail(e);
  }
};
