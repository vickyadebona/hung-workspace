import { getStore } from './store';

const WELCOME = `This is your shared workspace. Everything you write here is saved automatically as a plain Markdown file.

## Try it

- Type **/** on an empty line to insert headings, lists, checklists, code blocks, tables and more
- Use **+** next to a page in the sidebar to nest a page inside it
- Press **Ctrl/Cmd + K** to search every page
- Light and dark mode follow your computer; change it in Settings, under Preferences

## To do

- [ ] Add a page for TerraScape HQ
- [ ] Invite Andrew
- [x] Open the workspace for the first time
`;

/** First run only: make one page so the screen is never empty. */
export async function ensureWelcome(): Promise<void> {
  const store = getStore();
  const pages = await store.list();
  if (pages.length === 0) await store.create({ title: 'Welcome', icon: '👋', body: WELCOME });
}
