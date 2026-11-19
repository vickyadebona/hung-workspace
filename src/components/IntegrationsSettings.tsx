import { useEffect, useState } from 'react';
import { CalendarDaysIcon, PlugIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from './api';

/** Settings → Integrations: connect or disconnect your own Google Calendar (read only). */
export default function IntegrationsSettings() {
  return (
    <>
      <CalendarCard />
      <ConnectorCard />
    </>
  );
}

function CalendarCard() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.calendarStatus().then(setStatus).catch(() => setStatus({ configured: false, connected: false }));
  }, []);

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarDaysIcon className="size-5 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            Google Calendar
            {status && <Badge variant={status.connected ? 'default' : 'secondary'}>{status.connected ? 'Connected' : 'Not connected'}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Shows your next 3 days in the sidebar and a Calendar page. Read only: it can see your events but never change them. Each person connects their own calendar, and nobody else can see it.
          </p>
        </div>
        {status?.configured === false && <span className="text-xs text-muted-foreground">Not available: Google sign-in isn't set up.</span>}
        {status?.configured && !status.connected && (
          <Button onClick={() => (window.location.href = '/auth/calendar')}>Connect</Button>
        )}
        {status?.connected && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api.disconnectCalendar();
              window.location.reload(); // so the sidebar notices straight away
            }}
          >
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}

/** Personal access tokens for the connector that lets Claude, Duet and other tools read and add your tasks. */
function ConnectorCard() {
  const [tokens, setTokens] = useState<{ id: string; label: string; createdAt: string }[]>([]);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<string | null>(null); // shown once, right after it is made
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/mcp`;

  const load = () => api.tokens().then(setTokens).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* the text is visible; they can select it */
    }
  };

  return (
    <div className="border-t py-4">
      <div className="flex items-start gap-3">
        <PlugIcon className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="text-sm font-medium">Connector for Claude and other tools</div>
            <p className="text-xs text-muted-foreground">
              Lets a tool you trust read your tasks, add and complete them, and search or read your pages, as you. It can't see anyone else's private pages. Make one token per tool, and revoke it any time.
            </p>
          </div>
          <div className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. Claude" aria-label="Token name" maxLength={60} />
            <Button
              disabled={!label.trim()}
              onClick={async () => {
                setError('');
                try {
                  setFresh(await api.createToken(label));
                  setLabel('');
                  load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Create token
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {fresh && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
              <p className="font-medium">Copy this now: it is shown only once.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1">{fresh}</code>
                <Button size="sm" variant="outline" onClick={() => copy(fresh, 'token')}>
                  {copied === 'token' ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-muted-foreground">
                Server address (MCP, streamable HTTP):{' '}
                <button className="underline" onClick={() => copy(url, 'url')}>
                  {url}
                </button>
                {copied === 'url' && ' (copied)'}. Send the token as <code>Authorization: Bearer …</code>. If the tool can only take a web address, use <code>{url}?token=…</code>, but anyone who sees that address can use it.
              </p>
            </div>
          )}
          {tokens.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api.revokeToken(t.id);
                      load();
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
