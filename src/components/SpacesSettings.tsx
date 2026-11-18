import { useState } from 'react';
import { DownloadIcon, PlusIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { api, type Space } from './api';
import { ConfirmDeleteDialog } from './ConfirmDelete';

interface Props {
  spaces: Space[];
  me: string;
  onSpaceChange: (space: Space) => void;
  onLeft: (id: string) => void;
  onNew: () => void;
}

/** Settings → Spaces: every space you are in, who else is in it, and a way to take a copy of it. */
export default function SpacesSettings({ spaces, me, onSpaceChange, onLeft, onNew }: Props) {
  return (
    <div>
      {spaces.map((s, i) => (
        <div key={s.id}>
          {i > 0 && <Separator />}
          <SpaceBlock space={s} me={me} onSpaceChange={onSpaceChange} onLeft={onLeft} />
        </div>
      ))}
      <Separator />
      <div className="py-4">
        <Button variant="outline" onClick={onNew}>
          <PlusIcon /> New shared space
        </Button>
      </div>
    </div>
  );
}

function SpaceBlock({ space, me, onSpaceChange, onLeft }: Omit<Props, 'spaces' | 'onNew'> & { space: Space }) {
  const owner = space.owner === me;
  const personal = space.kind === 'personal';
  const [name, setName] = useState(space.name);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);

  const run = async (patch: Parameters<typeof api.updateSpace>[1]) => {
    setError('');
    const r = await api.updateSpace(space.id, patch);
    if (r.ok) onSpaceChange(r.space);
    else setError(r.error);
    return r.ok;
  };

  return (
    <section className="py-4" aria-label={space.name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg" aria-hidden>
          {space.icon}
        </span>
        {owner && !personal ? (
          <Input
            className="h-8 w-52"
            aria-label="Space name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const v = name.trim();
              if (!v) setName(space.name);
              else if (v !== space.name) run({ name: v });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="font-medium">{space.name}</span>
        )}
        <Badge variant="secondary">{personal ? 'Personal' : 'Shared'}</Badge>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <a href={`/api/spaces/${space.id}/export`} download>
            <DownloadIcon /> Export
          </a>
        </Button>
      </div>

      {personal ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Only you can see this space. It is left out of backups on purpose, so Export is how you keep your own copy: a .tar.gz of plain Markdown files.
        </p>
      ) : (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">People ({space.members.length})</div>
          <ul>
            {space.members.map((m) => (
              <li key={m} className="flex items-center gap-2 py-1 text-sm">
                <span className="truncate">{m}</span>
                {m === space.owner && <Badge variant="outline">Owner</Badge>}
                {m === me && m !== space.owner && <Badge variant="outline">You</Badge>}
                {owner && m !== space.owner && (
                  <Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" aria-label={`Remove ${m}`} onClick={() => run({ removeMember: m })}>
                    <XIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {owner ? (
            <form
              className="mt-2 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (email.trim() && (await run({ addMember: email.trim() }))) setEmail('');
              }}
            >
              <Input className="h-8" type="email" placeholder="Add someone by email" aria-label={`Add a person to ${space.name}`} value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button type="submit" size="sm" disabled={!email.trim()}>
                Add
              </Button>
            </form>
          ) : (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setLeaving(true)}>
              Leave this space
            </Button>
          )}
          {error && (
            <div className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
      <ConfirmDeleteDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={`Leave “${space.name}”?`}
        description="You will lose access to its pages until the owner adds you again."
        confirmLabel="Leave"
        onConfirm={async () => {
          if (await run({ removeMember: me })) onLeft(space.id);
        }}
      />
    </section>
  );
}
