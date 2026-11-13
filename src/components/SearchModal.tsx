import { useEffect, useState } from 'react';
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { api } from './api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (id: string) => void;
}

export default function SearchModal({ open, onOpenChange, onOpen }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; title: string; snippet: string }[]>([]);
  const [searched, setSearched] = useState(false);

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (open) {
      setQ('');
      setResults([]);
      setSearched(false);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      const r = await api.search(q);
      if (stale) return;
      setResults(r);
      setSearched(true);
    }, 150);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search pages" description="Search all pages by title or content." className="sm:max-w-xl">
      {/* The server does the matching, so the list is shown as returned. */}
      <Command shouldFilter={false}>
        <CommandInput value={q} onValueChange={setQ} placeholder="Search all pages…" />
        <CommandList>
          {searched && <CommandEmpty>No matches</CommandEmpty>}
          {results.map((r) => (
            <CommandItem key={r.id} value={r.id} onSelect={() => onOpen(r.id)} className="flex-col items-start gap-0.5">
              <span className="font-medium">{r.title || 'Untitled'}</span>
              {r.snippet && <span className="w-full truncate text-xs text-muted-foreground">{r.snippet}</span>}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
