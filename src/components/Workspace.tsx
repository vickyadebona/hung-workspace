import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRightIcon, ChevronsUpDownIcon, DatabaseIcon, FileTextIcon, LogOutIcon, PlusIcon, SearchIcon, SettingsIcon, Table2Icon, Trash2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { api, type Page, type PageMeta } from './api';
import { ConfirmDeleteDialog } from './ConfirmDelete';
import DatabaseView from './DatabaseView';
import PageEditor from './PageEditor';
import RowProps from './RowProps';
import SearchModal from './SearchModal';
import SettingsDialog, { Avatar } from './SettingsDialog';

interface Props {
  initialId: string | null;
  userName: string;
  userEmail: string;
}

function idFromPath(): string | null {
  const m = location.pathname.match(/^\/p\/([a-z0-9]+)/);
  return m ? m[1] : null;
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

function WorkspaceInner({ initialId, userName, userEmail }: Props) {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(initialId);
  const [page, setPage] = useState<Page | null>(null);
  const [rowDb, setRowDb] = useState<Page | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const go = useCallback((id: string | null, replace = false) => {
    const url = id ? `/p/${id}` : '/';
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    setCurrentId(id);
    setOpenMobile(false);
  }, [setOpenMobile]);

  // Back/forward buttons
  useEffect(() => {
    const on = () => setCurrentId(idFromPath());
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

  // Initial list; land on the first top-level page if no page is chosen
  useEffect(() => {
    refreshList().then((list) => {
      if (!idFromPath()) {
        const first = list.find((p) => !p.parent && !p.database) ?? list.find((p) => !p.database);
        if (first) go(first.id, true);
        else setLoading(false);
      }
    });
  }, [refreshList, go]);

  // Load the page body whenever the selection changes
  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    api.get(currentId).then(async (p) => {
      const parentDb = p?.database ? await api.get(p.database) : null;
      if (cancelled) return;
      setPage(p);
      setRowDb(parentDb);
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
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, reloadKey]);

  const pagesRef = useMemoRef(pages);

  useEffect(() => {
    localStorage.setItem('wn_expanded', JSON.stringify([...expanded]));
  }, [expanded]);

  const children = useMemo(() => {
    const m = new Map<string | null, PageMeta[]>();
    for (const p of pages) {
      if (p.database) continue; // database rows live inside their database, not in the sidebar
      const k = p.parent && pages.some((x) => x.id === p.parent) ? p.parent : null;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [pages]);

  const onMeta = useCallback((id: string, patch: { title?: string; icon?: string; updatedAt?: string }) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const addPage = async (parent: string | null) => {
    const p = await api.create({ parent });
    await refreshList();
    if (parent) setExpanded((prev) => new Set(prev).add(parent));
    go(p.id);
  };

  const addDatabase = async () => {
    const p = await api.create({ kind: 'database', title: 'Untitled database', parent: null });
    await refreshList();
    go(p.id);
  };

  const removePage = async (id: string) => {
    const removed = await api.remove(id);
    const list = await refreshList();
    if (currentId && removed.includes(currentId)) {
      const next = list.find((p) => !p.parent && !p.database) ?? list.find((p) => !p.database);
      go(next ? next.id : null, true);
      if (!next) setPage(null);
    }
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
  const emptyState = 'grid h-[60vh] place-items-center text-center text-muted-foreground';

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
            <Avatar name="Hung Workspace" className="size-6" />
            <span className="truncate text-sm font-semibold">Hung Workspace</span>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-foreground/80" onClick={() => openOver(setSearchOpen)}>
                <SearchIcon /> <span>Search</span>
                <Kbd className="ml-auto">⌘K</Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-foreground/80" onClick={() => openOver(setSettingsOpen)}>
                <SettingsIcon /> <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Pages</SidebarGroupLabel>
            <SidebarGroupContent>
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
                  <DropdownMenuItem onSelect={() => openOver(setSettingsOpen)}>
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
          {loading && <div className={emptyState}>Loading…</div>}
          {!loading && missing && (
            <div className={emptyState}>
              <div>
                <p>That page doesn't exist (it may have been deleted).</p>
                <Button variant="outline" className="mt-2" onClick={() => go(null, true)}>
                  Go home
                </Button>
              </div>
            </div>
          )}
          {!loading && !missing && !page && (
            <div className={emptyState}>
              <div>
                <p>No pages yet.</p>
                <Button className="mt-2" onClick={() => addPage(null)}>
                  <PlusIcon /> Create your first page
                </Button>
              </div>
            </div>
          )}
          {!loading && page && page.kind === 'database' && (
            <DatabaseView key={page.id} dbId={page.id} onMeta={onMeta} onOpenRow={(id) => go(id)} />
          )}
          {!loading && page && page.kind !== 'database' && (
            <PageEditor
              key={`${page.id}:${reloadKey}`}
              page={page}
              theme={theme.effective}
              onMeta={onMeta}
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
      />
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
    </>
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
}

const rowAction =
  'grid size-5 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-sidebar-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-3.5';

function Tree(props: TreeProps) {
  const { parent, depth, children, currentId, expanded, onToggle, onOpen, onAdd, onRemove } = props;
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
              <span className="absolute top-[5px] right-1 flex gap-0.5 md:hidden md:group-hover/row:flex md:group-focus-within/row:flex">
                {p.kind !== 'database' && (
                  <button className={rowAction} aria-label={`Add page inside ${p.title}`} title="Add a page inside" onClick={() => onAdd(p.id)}>
                    <PlusIcon />
                  </button>
                )}
                <button className={rowAction} aria-label={`Delete ${p.title}`} title="Delete" onClick={() => onRemove(p)}>
                  <Trash2Icon />
                </button>
              </span>
            </div>
            {open && kids.length > 0 && <Tree {...props} parent={p.id} depth={depth + 1} />}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
