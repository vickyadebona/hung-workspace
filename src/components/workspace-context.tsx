import { createContext, useContext, useMemo } from 'react';
import type { PageMeta, Space } from './api';

/** What every database screen needs to know about the wider workspace: who the people are, which spaces and databases exist. */
export interface WorkspaceData {
  people: Record<string, string>; // email -> name
  spaces: Space[];
  pages: PageMeta[];
  /** Open a page (used by page blocks inside a page's text). */
  openPage: (id: string) => void;
}

const Ctx = createContext<WorkspaceData>({ people: {}, spaces: [], pages: [], openPage: () => {} });
export const WorkspaceDataProvider = Ctx.Provider;
export const useWorkspaceData = () => useContext(Ctx);

/** The people who can be picked for a database in `spaceId` (its members), as { email, name }. */
export function useMembers(spaceId: string | undefined) {
  const { people, spaces } = useWorkspaceData();
  return useMemo(() => {
    const space = spaces.find((s) => s.id === spaceId);
    return (space?.members ?? []).map((email) => ({ email, name: people[email] || email.split('@')[0] }));
  }, [people, spaces, spaceId]);
}

/** Databases in the same space as `spaceId`, for choosing what a relation links to. */
export function useDatabases(spaceId: string | undefined) {
  const { pages } = useWorkspaceData();
  return useMemo(() => pages.filter((p) => p.kind === 'database' && p.space === spaceId), [pages, spaceId]);
}
