/**
 * Inline pages: a page that lives in the body of another page is stored in that page's Markdown as a line
 * containing only a link to it, `[📄 Title](/p/<id>)`. These helpers turn such lines into page blocks when a page
 * is opened, and find which pages a body refers to. (Plain data, no React, so it is easy to test.)
 */
export const PAGE_LINK = /^\/p\/([a-z0-9]{8,32})$/;

interface LooseBlock {
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: LooseBlock[];
  [key: string]: unknown;
}

/** Replace every paragraph that is nothing but a link to a page of this workspace with a page block. */
export function linkParagraphsToChildPages<T extends LooseBlock>(blocks: T[]): T[] {
  return blocks.map((b) => {
    const kids = b.children && b.children.length ? linkParagraphsToChildPages(b.children) : b.children;
    if (b.type === 'paragraph' && Array.isArray(b.content) && b.content.length === 1) {
      const only = b.content[0] as { type?: string; href?: string };
      const m = only?.type === 'link' && typeof only.href === 'string' ? PAGE_LINK.exec(only.href) : null;
      if (m) return { type: 'childPage', props: { pageId: m[1] }, children: kids ?? [] } as unknown as T;
    }
    return kids === b.children ? b : { ...b, children: kids };
  });
}

/** The ids of the pages shown as page blocks in a document. */
export function childPageIds(blocks: LooseBlock[]): string[] {
  const out: string[] = [];
  const walk = (list: LooseBlock[]) => {
    for (const b of list) {
      if (b.type === 'childPage' && typeof b.props?.pageId === 'string' && b.props.pageId) out.push(b.props.pageId);
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/**
 * Page blocks become plain link paragraphs just before a document is turned into Markdown. Going through plain
 * paragraphs keeps the export out of the editor's React renderer, which cannot run while the page is being closed.
 */
export function childPagesToLinks<T extends LooseBlock>(blocks: T[], lookup: (id: string) => { title: string; icon: string } | undefined): T[] {
  return blocks.map((b) => {
    const kids = b.children && b.children.length ? childPagesToLinks(b.children, lookup) : b.children;
    if (b.type === 'childPage') {
      const id = String(b.props?.pageId ?? '');
      const info = lookup(id);
      return {
        id: b.id,
        type: 'paragraph',
        props: {},
        content: [{ type: 'link', href: `/p/${id}`, content: `${info?.icon || '📄'} ${info?.title || 'Untitled'}` }],
        children: kids ?? [],
      } as unknown as T;
    }
    return kids === b.children ? b : { ...b, children: kids };
  });
}
