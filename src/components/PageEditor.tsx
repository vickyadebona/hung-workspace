import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { cn } from '@/lib/utils';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api, type Page } from './api';

type SaveState = 'saved' | 'saving' | 'error' | 'conflict';

interface Props {
  page: Page;
  theme: 'light' | 'dark';
  onMeta: (id: string, patch: { title?: string; icon?: string; updatedAt?: string }) => void;
  onReload: () => void;
  extra?: ReactNode;
}

const SAVE_DELAY_MS = 800;

export default function PageEditor({ page, theme, onMeta, onReload, extra }: Props) {
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
      <BlockNoteView editor={editor} theme={theme} onChange={schedule} />
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
