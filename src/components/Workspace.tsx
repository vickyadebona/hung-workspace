import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDaysIcon, CheckIcon, ListChecksIcon, ChevronRightIcon, ChevronsUpDownIcon, DatabaseIcon, FileTextIcon, FolderInputIcon, FoldersIcon, LogOutIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SettingsIcon, Table2Icon, Trash2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api, type Page, type PageMeta, type Space } from './api';
import { ConfirmDeleteDialog } from './ConfirmDelete';
import DatabaseView from './DatabaseView';
import PageEditor from './PageEditor';
import RowProps from './RowProps';
import SearchModal from './SearchModal';
import CalendarView from './CalendarView';
import MyTasksView from './MyTasksView';
import UpcomingEvents from './UpcomingEvents';
import NewSpaceDialog from './NewSpaceDialog';
import { PageSkeleton, SidebarSkeleton } from './Skeletons';
import SettingsDialog, { Avatar, type SettingsSection } from './SettingsDialog';
import { pageRegistry } from './childpage';
import { WorkspaceDataProvider } from './workspace-context';

export type AppView = 'page' | 'my-tasks' | 'calendar';

interface Props {
  initialView?: AppView;
  initialId: string | null;
  userName: string;
  userEmail: string;
}

function viewFromPath(): AppView {
  if (location.pathname.startsWith('/my-tasks')) return 'my-tasks';
  if (location.pathname.startsWith('/calendar')) return 'calendar';
  return 'page';
}

function idFromPath(): string | null {
  const m = location.pathname.match(/^\/p\/([a-z0-9]+)/);
  return m ? m[1] : null;
}

/** The page to land on in a space: its first top-level page. */
function firstPage(list: PageMeta[], space: string | null): PageMeta | undefined {
  const inSpace = list.filter((p) => p.space === space && !p.database);
  return inSpace.find((p) => !p.parent) ?? inSpace[0];
}

export default function Workspace(props: Props) {
  return (
    <TooltipProvider>
      <SidebarProvider style={{ '--sidebar-width': '17.5rem' } as React.CSSProperties}>
        <WorkspaceInner {...props} />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function WorkspaceInner({ initialId, initialView = 'page', userName, userEmail }: Props) {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(initialId);
  const [page, setPage] = useState<Page | null>(null);
  const [rowDb, setRowDb] = useState<Page | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<AppView>(initialView);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false); // the server could not be reached
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('preferences');
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [personalId, setPersonalId] = useState<string | null>(null);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [activeSpace, setActiveSpaceState] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PageMeta | null>(null);
  const logoutForm = useRef<HTMLFormElement>(null);
  const { setOpenMobile } = useSidebar();
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('wn_expanded') || '[]'));
    } catch {
      return new Set();
    }
  });
  const [reloadKey, setReloadKey] = useState(0);
  const theme = useTheme();

  const setActiveSpace = useCallback((id: string) => {
    setActiveSpaceState(id);
    try {
      localStorage.setItem('wn_space', id);
    } catch {
      /* private window: the choice just won't be remembered */
    }
  }, []);

  const go = useCallback((id: string | null, replace = false) => {
    const url = id ? `/p/${id}` : '/';
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    setCurrentId(id);
    setView('page');
    setOpenMobile(false);
  }, [setOpenMobile]);

  const openView = (v: AppView) => {
    history.pushState(null, '', v === 'my-tasks' ? '/my-tasks' : v === 'calendar' ? '/calendar' : '/');
    setView(v);
    setOpenMobile(false);
  };

  // Back/forward buttons
  useEffect(() => {
    const on = () => {
      setCurrentId(idFromPath());
      setView(viewFromPath());
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  // Ctrl/Cmd+K opens search
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const refreshList = useCallback(async () => {
    const list = await api.list();
    setPages(list);
    return list;
  }, []);

  // Initial load: spaces and pages together; land on the first top-level page of the chosen space if no page is chosen
  useEffect(() => {
    Promise.all([api.spaces(), refreshList()]).then(([sp, list]) => {
      setSpaces(sp.spaces);
      setPersonalId(sp.personal);
      setPeople(sp.people ?? {});
      if (idFromPath()) return; // the page's own space is picked once it loads
      if (viewFromPath() !== 'page') {
        setActiveSpace(sp.spaces.find((x) => x.id === localStorage.getItem('wn_space'))?.id ?? sp.personal);
        setLoading(false);
        return;
      }
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('wn_space');
      } catch {
        saved = null;
      }
      const space = sp.spaces.find((x) => x.id === saved)?.id ?? sp.personal;
      setActiveSpace(space);
      const first = firstPage(list, space);
      if (first) go(first.id, true);
      else setLoading(false);
    }).catch(() => {
      setLoadError(true);
      setLoading(false);
    });
  }, [refreshList, go, setActiveSpace]);

  // Load the page body whenever the selection changes
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setMissing(false);
    api.get(currentId).then(async (p) => {
      const parentDb = p?.database ? await api.get(p.database) : null;
      if (cancelled) return;
      setPage(p);
      setRowDb(parentDb);
      if (p) setActiveSpace(p.space); // opening a page from search or a link switches to its space
      setMissing(!p);
      setLoading(false);
      if (p) {
        // keep ancestors open so the current page is visible in the tree
        setExpanded((prev) => {
          const next = new Set(prev);
          let cur: string | null = p.parent;
          const byId = new Map(pagesRef.current.map((x) => [x.id, x]));
          while (cur) {
            next.add(cur);
            cur = byId.get(cur)?.parent ?? null;
          }
          return next;
        });
      }
    }).catch(() => {
      if (cancelled) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, reloadKey, setActiveSpace]);

  const pagesRef = useMemoRef(pages);

  useEffect(() => {
    localStorage.setItem('wn_expanded', JSON.stringify([...expanded]));
  }, [expanded]);

  const children = useMemo(() => {
    const m = new Map<string | null, PageMeta[]>();
    const inSpace = pages.filter((p) => p.space === activeSpace);
    for (const p of inSpace) {
      if (p.database) continue; // database rows live inside their database, not in the sidebar
      const k = p.parent && inSpace.some((x) => x.id === p.parent) ? p.parent : null;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [pages, activeSpace]);

  // Page blocks show (and export to Markdown) a page's current icon and title.
  useEffect(() => {
    pageRegistry.pages = new Map(pages.map((p) => [p.id, { title: p.title, icon: p.icon }]));
  }, [pages]);

  const onMeta = useCallback((id: string, patch: { title?: string; icon?: string; updatedAt?: string }) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const addPage = async (parent: string | null) => {
    const p = await api.create({ parent, space: activeSpace });
    await refreshList();
    if (parent) setExpanded((prev) => new Set(prev).add(parent));
    go(p.id);
  };

  const addDatabase = async () => {
    const p = await api.create({ kind: 'database', title: 'Untitled database', parent: null, space: activeSpace });
    await refreshList();
    go(p.id);
  };

  const removePage = async (id: string) => {
    const removed = await api.remove(id);
    const list = await refreshList();
    if (currentId && removed.includes(currentId)) {
      const next = firstPage(list, activeSpace);
      go(next ? next.id : null, true);
      if (!next) setPage(null);
    }
  };

  /** Show another space: its first page if it has one, otherwise an empty state with a "create your first page" button. */
  const switchSpace = (id: string) => {
    setActiveSpace(id);
    const first = firstPage(pages, id);
    if (first) go(first.id);
    else {
      history.pushState(null, '', '/');
      setCurrentId(null);
      setPage(null);
      setMissing(false);
      setLoading(false);
      setOpenMobile(false);
    }
  };

  const movePage = async (p: PageMeta, target: Space) => {
    try {
      const moved = await api.movePage(p.id, target.id);
      await refreshList();
      if (currentId && moved.includes(currentId)) {
        setActiveSpace(target.id);
        setReloadKey((k) => k + 1);
      } else if (p.id === (page?.database ?? null)) {
        setActiveSpace(target.id);
      }
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const onSpaceChange = (space: Space) => setSpaces((prev) => prev.map((x) => (x.id === space.id ? space : x)));
  const onSpaceCreated = (space: Space) => {
    setSpaces((prev) => [...prev, space]);
    setActiveSpace(space.id);
    history.pushState(null, '', '/');
    setCurrentId(null);
    setPage(null);
    setMissing(false);
    setLoading(false);
    setSettingsOpen(false);
  };
  const onLeftSpace = async (id: string) => {
    setSpaces((prev) => prev.filter((x) => x.id !== id));
    await refreshList();
    if (activeSpace === id && personalId) {
      setActiveSpace(personalId);
      const first = firstPage(await api.list(), personalId);
      if (first) go(first.id, true);
    }
  };
  const openSettings = (section: SettingsSection) => {
    setSettingsSection(section);
    setOpenMobile(false);
    setSettingsOpen(true);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Search and Settings open over the page, so on a phone the slide-out sidebar gets out of the way first.
  const openOver = (setOpen: (open: boolean) => void) => {
    setOpenMobile(false);
    setOpen(true);
  };
  const hasKids = (id: string) => (children.get(id) ?? []).length > 0;
  const activeInfo = spaces.find((x) => x.id === activeSpace);
  /** The pages above a page, outermost first (stops at the top of its space). */
  const ancestorsOf = (p: Page): PageMeta[] => {
    if (p.database) return [];
    const byId = new Map(pages.map((x) => [x.id, x]));
    const chain: PageMeta[] = [];
    let cur = p.parent ? byId.get(p.parent) : undefined;
    while (cur && chain.length < 12) {
      chain.unshift(cur);
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return chain;
  };
  const emptyState = 'grid h-[60vh] place-items-center text-center text-muted-foreground';

  return (
    <WorkspaceDataProvider value={{ people, spaces, pages, openPage: (id) => go(id) }}>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" aria-label="Switch space">
                    <span className="grid size-7 flex-none place-items-center rounded-md bg-sidebar-accent text-base" aria-hidden>
                      {activeInfo?.icon || '📁'}
                    </span>
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <span className="truncate text-sm font-semibold">{activeInfo?.name ?? 'Hung Workspace'}</span>
                      <span className="truncate text-xs text-muted-foreground">{activeInfo?.kind === 'personal' ? 'Only you' : activeInfo ? `${activeInfo.members.length} ${activeInfo.members.length === 1 ? 'person' : 'people'}` : ''}</span>
                    </span>
                    <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-60">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Spaces</DropdownMenuLabel>
                  {spaces.map((sp) => (
                    <DropdownMenuItem key={sp.id} onSelect={() => switchSpace(sp.id)}>
                      <span className="w-5 text-center" aria-hidden>
                        {sp.icon}
                      </span>
                      <span className="truncate">{sp.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{sp.kind === 'personal' ? 'Private' : 'Shared'}</span>
                      {sp.id === activeSpace && <CheckIcon className="text-primary" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setNewSpaceOpen(true)}>
                    <PlusIcon /> New shared space
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openSettings('spaces')}>
                    <FoldersIcon /> Manage spaces
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-foreground/80" onClick={() => openOver(setSearchOpen)}>
                <SearchIcon /> <span>Search</span>
                <Kbd className="ml-auto">⌘K</Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-foreground/80" isActive={view === 'my-tasks'} onClick={() => openView('my-tasks')}>
                <ListChecksIcon /> <span>My tasks</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-foreground/80" isActive={view === 'calendar'} onClick={() => openView('calendar')}>
                <CalendarDaysIcon /> <span>Calendar</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-foreground/80" onClick={() => openSettings('preferences')}>
                <SettingsIcon /> <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <UpcomingEvents onOpenCalendar={() => openView('calendar')} />
          <SidebarGroup>
            <SidebarGroupLabel>{activeInfo?.kind === 'personal' ? 'My pages' : 'Pages'}</SidebarGroupLabel>
            <SidebarGroupContent>
              {spaces.length === 0 && !loadError && <SidebarSkeleton />}
              <nav aria-label="Pages">
                <Tree
                  parent={null}
                  depth={0}
                  children={children}
                  currentId={page?.database ?? currentId}
                  expanded={expanded}
                  onToggle={toggle}
                  onOpen={(id) => go(id)}
                  onAdd={addPage}
                  onRemove={setDeleting}
                  spaces={spaces}
                  activeSpace={activeSpace}
                  onMove={movePage}
                />
              </nav>
              <SidebarMenu className="mt-1">
                <SidebarMenuItem>
                  <SidebarMenuButton className="text-sidebar-foreground/70" onClick={() => addPage(null)}>
                    <PlusIcon /> <span>New page</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton className="text-sidebar-foreground/70" onClick={addDatabase}>
                    <DatabaseIcon /> <span>New database</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" aria-label="Account menu">
                    <Avatar name={userName} />
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <span className="truncate text-sm font-medium">{userName}</span>
                      <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                    </span>
                    <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                  <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{userEmail}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openSettings('preferences')}>
                    <SettingsIcon /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => logoutForm.current?.submit()}>
                    <LogOutIcon /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
          <form ref={logoutForm} method="post" action="/auth/logout" hidden />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-10 flex-none items-center px-2">
          <SidebarTrigger className="text-muted-foreground" />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {view === 'my-tasks' && <MyTasksView onOpen={(id) => go(id)} />}
          {view === 'calendar' && <CalendarView />}
          {view === 'page' && loading && !loadError && <PageSkeleton />}
          {view === 'page' && loadError && (
            <div className={emptyState}>
              <div>
                <p>Couldn't reach the server.</p>
                <p className="text-sm">Check your connection (or that the app is running), then try again.</p>
                <Button className="mt-3" variant="outline" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </div>
            </div>
          )}
          {view === 'page' && !loading && !loadError && missing && (
            <div className={emptyState}>
              <div>
                <p>That page doesn't exist (it may have been deleted).</p>
                <Button variant="outline" className="mt-2" onClick={() => go(null, true)}>
                  Go home
                </Button>
              </div>
            </div>
          )}
          {view === 'page' && !loading && !loadError && !missing && !page && (
            <div className={emptyState}>
              <div>
                <p>No pages yet.</p>
                <Button className="mt-2" onClick={() => addPage(null)}>
                  <PlusIcon /> Create your first page
                </Button>
              </div>
            </div>
          )}
          {view === 'page' && !loading && !loadError && page && page.kind === 'database' && (
            <DatabaseView key={page.id} dbId={page.id} onMeta={onMeta} onOpenRow={(id) => go(id)} />
          )}
          {view === 'page' && !loading && !loadError && page && page.kind !== 'database' && (
            <PageEditor
              key={`${page.id}:${reloadKey}`}
              page={page}
              theme={theme.effective}
              onMeta={onMeta}
              ancestors={ancestorsOf(page)}
              subpages={page.database ? [] : (children.get(page.id) ?? [])}
              spaceName={activeInfo?.name}
              onOpen={(id) => go(id)}
              onSubCreated={async (child) => {
                await refreshList();
                setExpanded((prev) => new Set(prev).add(child.parent ?? ''));
                go(child.id);
              }}
              extra={page.database && rowDb ? <RowProps key={`${page.id}:${reloadKey}`} row={page} db={rowDb} onOpenDb={() => go(rowDb.id)} onDb={setRowDb} /> : undefined}
              onReload={() => {
                refreshList();
                setReloadKey((k) => k + 1);
              }}
            />
          )}
        </div>
      </SidebarInset>

      <SearchModal
        spaces={spaces}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onOpen={(id) => {
          setSearchOpen(false);
          go(id);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        user={{ name: userName, email: userEmail }}
        theme={theme}
        onSignOut={() => logoutForm.current?.submit()}
        spaces={spaces}
        openSection={settingsSection}
        onSpaceChange={onSpaceChange}
        onLeftSpace={onLeftSpace}
        onNewSpace={() => setNewSpaceOpen(true)}
      />
      <NewSpaceDialog open={newSpaceOpen} onOpenChange={setNewSpaceOpen} onCreated={onSpaceCreated} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title || 'Untitled'}”?`}
        description={
          deleting && hasKids(deleting.id) ? 'Its subpages are deleted too.' : deleting?.kind === 'database' ? 'Its rows are deleted too.' : 'This page is removed from the workspace.'
        }
        onConfirm={() => {
          if (deleting) removePage(deleting.id);
          setDeleting(null);
        }}
      />
    </WorkspaceDataProvider>
  );
}

function useMemoRef<T>(value: T) {
  const ref = useMemo(() => ({ current: value }), []);
  ref.current = value;
  return ref;
}

interface TreeProps {
  parent: string | null;
  depth: number;
  children: Map<string | null, PageMeta[]>;
  currentId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAdd: (parent: string | null) => void;
  onRemove: (page: PageMeta) => void;
  spaces: Space[];
  activeSpace: string | null;
  onMove: (page: PageMeta, space: Space) => void;
}

const rowAction =
  'grid size-5 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-sidebar-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-3.5';

function Tree(props: TreeProps) {
  const { parent, depth, children, currentId, expanded, onToggle, onOpen, onAdd, onRemove, spaces, activeSpace, onMove } = props;
  const others = spaces.filter((x) => x.id !== activeSpace);
  const items = children.get(parent) ?? [];
  if (depth === 0 && items.length === 0) return null;
  return (
    <SidebarMenu role={depth === 0 ? 'tree' : 'group'} className="gap-0.5">
      {items.map((p) => {
        const kids = children.get(p.id) ?? [];
        const open = expanded.has(p.id);
        const Fallback = p.kind === 'database' ? Table2Icon : FileTextIcon;
        return (
          <SidebarMenuItem key={p.id} role="treeitem" aria-expanded={kids.length ? open : undefined}>
            {/* One row. Its actions show on hover or keyboard focus (always on touch screens). */}
            <div className="group/row relative">
              <SidebarMenuButton
                isActive={p.id === currentId}
                className="h-[30px] pr-14 md:pr-2 md:group-hover/row:pr-14 md:group-focus-within/row:pr-14"
                style={{ paddingLeft: 26 + depth * 14 }}
                onClick={() => onOpen(p.id)}
              >
                {p.icon ? <span className="w-4 flex-none text-center">{p.icon}</span> : <Fallback className="text-muted-foreground" />}
                <span>{p.title || 'Untitled'}</span>
              </SidebarMenuButton>
              {kids.length > 0 && (
                <button className={cn(rowAction, 'absolute top-[5px]')} style={{ left: 4 + depth * 14 }} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => onToggle(p.id)}>
                  <ChevronRightIcon className={cn('transition-transform', open && 'rotate-90')} />
                </button>
              )}
              <span className="absolute top-[5px] right-1 flex gap-0.5 md:hidden md:group-hover/row:flex md:group-focus-within/row:flex md:has-[[data-state=open]]:flex">
                {p.kind !== 'database' && (
                  <button className={rowAction} aria-label={`Add page inside ${p.title}`} title="Add a page inside" onClick={() => onAdd(p.id)}>
                    <PlusIcon />
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className={rowAction} aria-label={`More actions for ${p.title}`} title="More">
                      <MoreHorizontalIcon />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-48">
                    {others.length > 0 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <FolderInputIcon /> Move to space
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="min-w-48">
                          {others.map((sp) => (
                            <DropdownMenuItem key={sp.id} onSelect={() => onMove(p, sp)}>
                              <span className="w-5 text-center" aria-hidden>
                                {sp.icon}
                              </span>
                              <span className="truncate">{sp.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuItem variant="destructive" onSelect={() => onRemove(p)}>
                      <Trash2Icon /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </div>
            {open && kids.length > 0 && <Tree {...props} parent={p.id} depth={depth + 1} />}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
