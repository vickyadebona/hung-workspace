import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childPageIds, childPagesToLinks, linkParagraphsToChildPages } from '../src/components/childpage-blocks.ts';

const ID = 'abcdef0123456789';
const link = (href: string, text = '📄 Title') => ({ type: 'paragraph', content: [{ type: 'link', href, content: text }], children: [] as any[] });

test('a paragraph that is only a link to a page becomes a page block', () => {
  const [b] = linkParagraphsToChildPages([link(`/p/${ID}`)]);
  assert.equal(b.type, 'childPage');
  assert.equal((b as any).props.pageId, ID);
});

test('ordinary links and mixed paragraphs are left alone', () => {
  const web = link('https://example.com');
  const mixed = { type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'link', href: `/p/${ID}`, content: 'this' }], children: [] };
  const badId = link('/p/short');
  const out = linkParagraphsToChildPages([web, mixed, badId] as any[]);
  assert.deepEqual(out.map((b) => b.type), ['paragraph', 'paragraph', 'paragraph']);
});

test('page blocks nested inside list items are found too', () => {
  const doc = [{ type: 'bulletListItem', content: [], children: [link(`/p/${ID}`)] }] as any[];
  const out = linkParagraphsToChildPages(doc);
  assert.equal(out[0].children![0].type, 'childPage');
  assert.deepEqual(childPageIds(out), [ID]);
});

test('saving: a page block turns back into a link line with the current icon and title', () => {
  const doc = [{ id: 'b1', type: 'childPage', props: { pageId: ID }, children: [] }, { type: 'paragraph', content: 'text', children: [] }] as any[];
  const out = childPagesToLinks(doc, (id) => (id === ID ? { title: 'Launch plan', icon: '🚀' } : undefined));
  assert.equal(out[0].type, 'paragraph');
  const c = (out[0].content as any[])[0];
  assert.equal(c.href, `/p/${ID}`);
  assert.equal(c.content, '🚀 Launch plan');
  assert.equal(out[1], doc[1]); // untouched blocks are the same objects
  // a page the app doesn't know about still saves as a valid link
  const unknown = childPagesToLinks(doc, () => undefined);
  assert.equal((unknown[0].content as any[])[0].content, '📄 Untitled');
});

test('round trip: link line -> page block -> link line keeps the page', () => {
  const blocks = linkParagraphsToChildPages([link(`/p/${ID}`, '📄 Old name')] as any[]);
  const saved = childPagesToLinks(blocks, () => ({ title: 'New name', icon: '' })) as any[];
  assert.equal(saved[0].content[0].href, `/p/${ID}`);
  assert.equal(saved[0].content[0].content, '📄 New name');
});
