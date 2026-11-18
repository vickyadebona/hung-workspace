import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import { FileTextIcon, Table2Icon } from 'lucide-react';
import { useWorkspaceData } from './workspace-context';

/**
 * What the Markdown export needs to know about pages. The app keeps this map up to date (see Workspace), so the exported
 * link text always carries the page's current icon and title. (A page block is saved as a line with just a link to the
 * page; see childpage-blocks.ts.)
 */
export const pageRegistry: { pages: Map<string, { title: string; icon: string }> } = { pages: new Map() };

/** A page shown inside another page's text: its icon and current title, a click opens it. */
function ChildPageRow({ id }: { id: string }) {
  const { pages, openPage } = useWorkspaceData();
  const page = pages.find((p) => p.id === id);
  if (!page) {
    return (
      <div contentEditable={false} className="my-0.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-muted-foreground">
        <FileTextIcon className="size-4" /> A page that was deleted or that you can't see
      </div>
    );
  }
  return (
    <div contentEditable={false} className="my-0.5">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-base font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => openPage(id)}
      >
        {page.icon ? <span aria-hidden>{page.icon}</span> : page.kind === 'database' ? <Table2Icon className="size-4 text-muted-foreground" /> : <FileTextIcon className="size-4 text-muted-foreground" />}
        <span className="truncate underline decoration-muted-foreground/40 underline-offset-4">{page.title || 'Untitled'}</span>
      </button>
    </div>
  );
}

const ChildPage = createReactBlockSpec(
  { type: 'childPage', propSchema: { pageId: { default: '' } }, content: 'none' },
  {
    render: ({ block }) => <ChildPageRow id={block.props.pageId} />,
  },
);

/** The editor's blocks: everything it already had, plus page blocks. */
export const pageSchema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, childPage: ChildPage() } });
