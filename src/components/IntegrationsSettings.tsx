import { useEffect, useState } from 'react';
import { CalendarDaysIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from './api';

/** Settings → Integrations: connect or disconnect your own Google Calendar (read only). */
export default function IntegrationsSettings() {
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
