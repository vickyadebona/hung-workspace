import { useEffect, useState, type ReactNode } from 'react';
import { FoldersIcon, LogOutIcon, PlugIcon, MonitorIcon, MoonIcon, SlidersHorizontalIcon, SunIcon, UserIcon, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Theme, ThemePref } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { Space } from './api';
import IntegrationsSettings from './IntegrationsSettings';
import SpacesSettings from './SpacesSettings';

export type SettingsSection = 'account' | 'preferences' | 'spaces' | 'integrations';
type Section = SettingsSection;

const SECTIONS: { id: Section; label: string; icon: LucideIcon; blurb: string }[] = [
  { id: 'account', label: 'My account', icon: UserIcon, blurb: 'Who you are signed in as.' },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontalIcon, blurb: 'How the workspace looks for you.' },
  { id: 'spaces', label: 'Spaces', icon: FoldersIcon, blurb: 'Your Personal space and the shared spaces you are in.' },
  { id: 'integrations', label: 'Integrations', icon: PlugIcon, blurb: 'Connect outside services for your own account.' },
];

const THEMES: { value: ThemePref; label: string; icon: LucideIcon }[] = [
  { value: 'auto', label: 'Use system setting', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { name: string; email: string };
  theme: Theme;
  onSignOut: () => void;
  spaces: Space[];
  /** Which section to show each time the window opens. */
  openSection?: SettingsSection;
  onSpaceChange: (space: Space) => void;
  onLeftSpace: (id: string) => void;
  onNewSpace: () => void;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('grid size-7 flex-none place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground uppercase', className)} aria-hidden>
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

/** One setting: what it is on the left, the control on the right. */
function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0">
        <div className="text-sm">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="flex-none">{children}</div>
    </div>
  );
}

/** Settings window: sections down the left, the chosen section on the right. */
export default function SettingsDialog({ open, onOpenChange, user, theme, onSignOut, spaces, openSection = 'preferences', onSpaceChange, onLeftSpace, onNewSpace }: Props) {
  const [section, setSection] = useState<Section>(openSection);
  useEffect(() => {
    if (open) setSection(openSection);
  }, [open, openSection]);
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(620px,88vh)] w-[min(920px,94vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none md:flex-row">
        <nav aria-label="Settings sections" className="flex flex-none gap-1 overflow-x-auto border-b bg-sidebar p-2 text-sidebar-foreground md:w-60 md:flex-col md:border-r md:border-b-0 md:p-3">
          <div className="hidden px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground md:block">Account</div>
          <div className="mb-1 hidden items-center gap-2 px-2 py-1 md:flex">
            <Avatar name={user.name} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
          </div>
          {SECTIONS.map((s) => (
            <Button
              key={s.id}
              variant="ghost"
              size="sm"
              aria-current={s.id === section ? 'page' : undefined}
              className={cn('justify-start font-normal hover:bg-sidebar-accent', s.id === section && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground')}
              onClick={() => setSection(s.id)}
            >
              <s.icon /> {s.label}
            </Button>
          ))}
        </nav>

        <section className="min-w-0 flex-1 overflow-y-auto px-6 py-6 md:px-10 md:py-8">
          <DialogTitle className="text-base">{current.label}</DialogTitle>
          <DialogDescription className="sr-only">{current.blurb}</DialogDescription>
          <Separator className="mt-3 mb-1" />

          {section === 'preferences' && (
            <Row title="Appearance" description="Choose how Hung Workspace looks on this device.">
              <Select value={theme.pref} onValueChange={(v) => theme.setPref(v as ThemePref)}>
                <SelectTrigger className="w-48" aria-label="Appearance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  {THEMES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <t.icon /> {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          )}

          {section === 'integrations' && <IntegrationsSettings />}

          {section === 'spaces' && <SpacesSettings spaces={spaces} me={user.email} onSpaceChange={onSpaceChange} onLeft={onLeftSpace} onNew={onNewSpace} />}

          {section === 'account' && (
            <>
              <div className="flex items-center gap-3 py-4">
                <Avatar name={user.name} className="size-12 rounded-xl text-lg" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{user.name}</div>
                  <div className="truncate text-sm text-muted-foreground">{user.email}</div>
                </div>
              </div>
              <Separator />
              <Row title="Log out" description="You'll need to sign in with Google again on this device.">
                <Button variant="outline" onClick={onSignOut}>
                  <LogOutIcon /> Log out
                </Button>
              </Row>
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
