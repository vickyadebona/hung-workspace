import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api, type Space } from './api';
import IconPicker from './IconPicker';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (space: Space) => void;
}

/** Name a new shared space (you become its owner and can add people from Settings → Spaces). */
export default function NewSpaceDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setIcon('');
      setError('');
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const space = await api.createSpace(name.trim(), icon.trim() || undefined);
      onOpenChange(false);
      onCreated(space);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onOpenAutoFocus={(e) => {
          // start in the name box, not the (first-in-order) icon box
          e.preventDefault();
          nameInput.current?.focus();
        }}
      >
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New shared space</DialogTitle>
            <DialogDescription>A separate place for one project or topic. Only people you add can see it.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <IconPicker className="grid size-8 flex-none place-items-center rounded-lg border text-lg hover:bg-muted" label="Space icon" placeholder="📁" value={icon} onChange={setIcon} />
            <Input ref={nameInput} value={name} maxLength={60} placeholder="Space name" aria-label="Space name" onChange={(e) => setName(e.target.value)} />
          </div>
          {error && (
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || busy}>
              Create space
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
