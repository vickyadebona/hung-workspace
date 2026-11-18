import crypto from 'node:crypto';
import { LEGACY_SPACE_ID, type PageStore, type Space } from './storage.ts';

/** One stable id per person, so a Personal space is never created twice. */
export function personalSpaceId(email: string): string {
  return 'u' + crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 15);
}

export const PERSONAL_WELCOME = `This is your **Personal** space. Only you can see what is in it; nobody else who signs in to Hung Workspace can open these pages.

## Spaces

- Use the space name at the top of the sidebar to switch between your Personal space and shared spaces.
- Make a shared space for each project (**New shared space**), then add people from **Settings → Spaces**.
- To share something from here, move it into a shared space: hover a page in the sidebar, open **⋯**, and choose **Move to space**.

## Try it

- Type **/** on an empty line to insert headings, lists, checklists, code blocks, tables and more
- Use **+** next to a page in the sidebar to nest a page inside it
- Press **Ctrl/Cmd + K** to search every page you can see
- Light and dark mode follow your computer; change it in Settings, under Preferences
`;

const sortSpaces = (list: Space[]): Space[] =>
  [...list].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt) : a.kind === 'personal' ? -1 : 1));

/**
 * Make sure the spaces everyone expects exist, then return the ones `user` belongs to.
 *  - Pages from before spaces existed live in a shared "TerraScape HQ" space; it is created the first time
 *    it is needed, with everyone currently allowed to sign in as a member.
 *  - Every person gets a private Personal space (with a welcome page) the first time they show up.
 * Safe to call on every request: each step does nothing once it has happened.
 */
export async function ensureSpacesFor(store: PageStore, user: { email: string }, allowed: string[]): Promise<Space[]> {
  const email = user.email.trim().toLowerCase();
  let spaces = await store.listSpaces();

  if (!spaces.some((s) => s.id === LEGACY_SPACE_ID)) {
    const pages = await store.list();
    const legacy = pages.filter((p) => p.space === LEGACY_SPACE_ID);
    if (legacy.length > 0) {
      // Members are exactly the people allowed to sign in. (Whoever happens to trigger this is not added on the side.)
      const listed = [...new Set(allowed.map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const members = listed.length ? listed : [email];
      await store.createSpace({
        id: LEGACY_SPACE_ID,
        name: 'TerraScape HQ',
        icon: '🚀',
        kind: 'shared',
        owner: members[0],
        members,
        createdAt: legacy.map((p) => p.createdAt).sort()[0],
      });
    }
  }

  const pid = personalSpaceId(email);
  if (!spaces.some((s) => s.id === pid)) {
    const created = await store.createSpace({
      id: pid,
      name: 'Personal',
      icon: '🏠',
      kind: 'personal',
      owner: email,
      members: [email],
      createdAt: new Date().toISOString(),
    });
    // Only the request that actually created the space writes the welcome page (two tabs at once can't make two).
    if (created) await store.create({ space: pid, title: 'Welcome', icon: '👋', body: PERSONAL_WELCOME });
  }

  spaces = await store.listSpaces();
  return sortSpaces(spaces.filter((s) => s.members.includes(email)));
}
