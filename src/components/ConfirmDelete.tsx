import { useState, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
}

/** "Are you sure?" dialog shown before anything is deleted. */
export function ConfirmDeleteDialog({ open, onOpenChange, title, description, confirmLabel = 'Delete', onConfirm }: DialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface ButtonProps {
  /** What is being deleted, for the button's accessible name. */
  label: string;
  title: string;
  description?: ReactNode;
  onConfirm: () => void;
  className?: string;
}

/** A small × button that asks before deleting. */
export default function DeleteButton({ label, title, description, onConfirm, className }: ButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className={cn('text-muted-foreground', className)}
        aria-label={`Delete ${label}`}
        title="Delete"
        onClick={() => setOpen(true)}
      >
        <XIcon />
      </Button>
      <ConfirmDeleteDialog open={open} onOpenChange={setOpen} title={title} description={description} onConfirm={onConfirm} />
    </>
  );
}
