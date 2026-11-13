import { useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Popover as PopoverRoot, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface Props {
  /** The button that opens the popover. */
  trigger: ReactElement;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  /** Extra classes for the panel. */
  className?: string;
}

/** A small dropdown panel: closes on outside click or Escape. */
export default function Popover({ trigger, children, align = 'start', className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <PopoverRoot open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className={cn('flex max-h-[60vh] w-auto min-w-48 flex-col gap-1 overflow-auto p-1.5', className)}>
        {children(() => setOpen(false))}
      </PopoverContent>
    </PopoverRoot>
  );
}

/** Small uppercase heading inside a popover panel. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</div>;
}

/** Muted helper line inside a popover panel. */
export function MenuNote({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1.5 text-sm text-muted-foreground">{children}</div>;
}
