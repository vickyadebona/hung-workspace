import { useState } from 'react';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** The emoji a page gets when it is made, and the one shown (faded) for pages that have none. */
export const DEFAULT_ICON = '😊';

interface Props {
  value: string;
  onChange: (icon: string) => void;
  /** What to show faded when no icon is set. */
  placeholder?: string;
  label: string;
  className?: string;
}

/**
 * A button showing the icon; clicking it opens a proper emoji picker (search, categories, recently used)
 * instead of making you type or paste an emoji.
 */
export default function IconPicker({ value, onChange, placeholder = DEFAULT_ICON, label, className }: Props) {
  const [open, setOpen] = useState(false);
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title="Change icon" className={cn('cursor-pointer', className)}>
          <span className={value ? '' : 'opacity-40'}>{value || placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 p-0">
        <EmojiPicker
          emojiStyle={EmojiStyle.NATIVE}
          theme={dark ? Theme.DARK : Theme.LIGHT}
          lazyLoadEmojis
          width={320}
          height={380}
          previewConfig={{ showPreview: false }}
          searchPlaceholder="Search emoji"
          onEmojiClick={(e) => {
            onChange(e.emoji);
            setOpen(false);
          }}
        />
        {value && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              <XIcon /> Remove icon
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
