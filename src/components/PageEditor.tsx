import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { filterSuggestionItems } from '@blocknote/core';
import { SuggestionMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { cn } from '@/lib/utils';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChevronRightIcon, FileTextIcon, PlusIcon, Table2Icon } from 'lucide-react';
import { api, type Page, type PageMeta } from './api';

type SaveState = 'saved' | 'saving' | 'error' | 'conflict';

interface Props {
  page: Page;
  theme: 'light' | 'dark';
  onMeta: (id: string, patch: { title?: string; icon?: string; updatedAt?: string }) => void;
  onReload: () => void;
  extra?: ReactNode;
  /** Pages above this one, outermost first (for the breadcrumb). */
  ancestors?: PageMeta[];
  /** Pages directly inside this one. */
  subpages?: PageMeta[];
  spaceName?: string;
  onOpen?: (id: string) => void;
  /** Called after a sub-page has been created, so the sidebar can refresh and the new page can open. */
  onSubCreated?: (child: Page) => void;
}

const SAVE_DELAY_MS = 800;

export default function PageEditor({ page, theme, onMeta, onReload, extra, ancestors = [], subpages = [], spaceName, onOpen, onSubCreated }: Props) {
  const editor = useCreateBlockNote();
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [state, setState] = useState<SaveState>('saved');

  const baseUpdatedAt = useRef(page.updatedAt);
  const savedBody = useRef(page.body);
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const blocked = useRef(false); // true after a conflict: never overwrite someone else's change
  const latest = useRef({ title: page.title, icon: page.icon });

  // Load the Markdown body into the editor once.
  useEffect(() => {
    const blocks = editor.tryParseMarkdownToBlocks(page.body);
    editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: 'paragraph' }]);
    // Remember the editor's own normalised form so merely opening a page never triggers a save.
    savedBody.current = editor.blocksToMarkdownLossy(editor.document);
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(() => {
    if (blocked.current) return;
    // Read the editor now (not later): the editor may be torn down when the user switches pages.
    const body = editor.blocksToMarkdownLossy(editor.document);
    const snapshot = { title: latest.current.title, icon: latest.current.icon };
    queue.current = queue.current.then(async () => {
      if (blocked.current) return;
      const patch: Record<string, string> = { title: snapshot.title, icon: snapshot.icon };
      if (body !== savedBody.current) patch.body = body;
      setState('saving');
      const res = await api.update(page.id, { ...patch, baseUpdatedAt: baseUpdatedAt.current }).catch(() => null);
      if (!res) {
        setState('error');
        return;
      }
      if (res.ok) {
        baseUpdatedAt.current = res.page.updatedAt;
        if (patch.body !== undefined) savedBody.current = body;
        onMeta(page.id, { updatedAt: res.page.updatedAt });
        setState('saved');
      } else if (res.conflict) {
        blocked.current = true;
        setState('conflict');
      } else {
        setState('error');
      }
    });
  }, [editor, page.id, onMeta]);

  const schedule = useCallback(() => {
    if (!loaded.current || blocked.current) return;
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  // Save pending edits if the tab closes or the user switches page.
  useEffect(() => {
    const flush = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        save();
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [save]);

  /** Make a page inside this one. With a block, also leave a link to it in the text where the cursor is. */
  const createSub = async (withLink: boolean) => {
    if (blocked.current) return;
    const child = await api.create({ parent: page.id, title: 'Untitled' });
    if (withLink) {
      const here = editor.getTextCursorPosition().block;
      editor.insertBlocks([{ type: 'paragraph', content: [{ type: 'link', href: `/p/${child.id}`, content: '📄 Untitled' }] }], here, 'after');
    }
    onSubCreated?.(child);
  };

  const slashItems = async (query: string) =>
    filterSuggestionItems(
      [
        ...getDefaultReactSlashMenuItems(editor),
        {
          title: 'Sub-page',
          subtext: 'Create a page inside this one and link to it here',
          aliases: ['page', 'subpage', 'sub-page', 'new page'],
          group: 'Basic blocks',
          onItemClick: () => {
            void createSub(true);
          },
        },
      ],
      query,
    );

  // A link to another page in this workspace opens inside the app instead of reloading it.
  const followLinks = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a[href^="/p/"]');
    if (!a || !onOpen) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const id = a.getAttribute('href')!.slice(3).split(/[/?#]/)[0];
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    onOpen(id);
  };

  const label: Record<SaveState, string> = {
    saved: 'Saved',
    saving: 'Saving…',
    error: 'Could not save. Retrying on your next edit.',
    conflict: 'Changed elsewhere',
  };

  return (
    <div className={pageShell}>
      {state === 'conflict' && (
        <Banner action={<Button size="sm" variant="outline" onClick={onReload}>Load latest</Button>}>
          This page was changed on another device or by someone else, so saving is paused to protect their changes.
        </Banner>
      )}
      {ancestors.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-0.5 text-sm text-muted-foreground md:pl-[54px]">
          {spaceName && <span className="px-1.5">{spaceName}</span>}
          {ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-0.5">
              {(spaceName || a !== ancestors[0]) && <ChevronRightIcon className="size-3.5" aria-hidden />}
              <Button variant="ghost" size="xs" className="h-6 max-w-48 text-muted-foreground" onClick={() => onOpen?.(a.id)}>
                <span aria-hidden>{a.icon}</span>
                <span className="truncate">{a.title || 'Untitled'}</span>
              </Button>
            </span>
          ))}
        </nav>
      )}
      <div className="mb-3 flex items-center gap-2 md:pl-[54px]">
        <input
          className={iconInput}
          value={icon}
          maxLength={4}
          placeholder="🙂"
          aria-label="Page icon"
          onChange={(e) => {
            setIcon(e.target.value);
            latest.current.icon = e.target.value;
            onMeta(page.id, { icon: e.target.value });
            schedule();
          }}
        />
        <input
          className={titleInput}
          value={title}
          placeholder="Untitled"
          aria-label="Page title"
          onChange={(e) => {
            setTitle(e.target.value);
            latest.current.title = e.target.value;
            onMeta(page.id, { title: e.target.value || 'Untitled' });
            schedule();
          }}
        />
        <span className={cn('text-xs whitespace-nowrap text-muted-foreground', (state === 'error' || state === 'conflict') && 'text-destructive')} aria-live="polite">
          {label[state]}
        </span>
      </div>
      {extra}
      <div onClickCapture={followLinks}>
        <BlockNoteView editor={editor} theme={theme} onChange={schedule} slashMenu={false}>
          <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        </BlockNoteView>
      </div>

      <section aria-label="Sub-pages" className="mt-8 border-t pt-4">
        {subpages.length > 0 && (
          <>
            <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Sub-pages</h2>
            <ul className="mb-2">
              {subpages.map((c) => (
                <li key={c.id}>
                  <Button variant="ghost" size="sm" className="w-full justify-start font-normal" onClick={() => onOpen?.(c.id)}>
                    {c.icon ? <span aria-hidden>{c.icon}</span> : c.kind === 'database' ? <Table2Icon className="text-muted-foreground" /> : <FileTextIcon className="text-muted-foreground" />}
                    <span className="truncate">{c.title || 'Untitled'}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void createSub(false)}>
          <PlusIcon /> Add a sub-page
        </Button>
      </section>
    </div>
  );
}

/* Shared by the page and database headers. */
export const pageShell = 'mx-auto max-w-[860px] px-[18px] pt-6 pb-28 md:px-14 md:pt-10';
export const iconInput =
  'w-12 rounded-md border-0 bg-transparent p-0.5 text-center text-3xl outline-none hover:bg-muted focus-visible:bg-muted';
export const titleInput =
  'min-w-0 flex-1 border-0 bg-transparent py-1 text-3xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground md:text-4xl';

/** A yellow notice across the top of a page, with one action. */
export function Banner({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <Alert className="mb-4 border-transparent bg-warn text-warn-foreground has-data-[slot=alert-action]:pr-32">
      <AlertDescription className="text-warn-foreground">{children}</AlertDescription>
      <AlertAction>{action}</AlertAction>
    </Alert>
  );
}
