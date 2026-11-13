import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface SelectOption {
  value: string;
  label: ReactNode;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  'aria-label': string;
  placeholder?: string;
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
}

// The select primitive reserves the empty string for "nothing chosen", so an option whose value is ''
// (like "No status") travels under this name instead.
const EMPTY = '__empty__';

/** A dropdown for a plain list of choices. */
export default function SimpleSelect({ value, onChange, options, placeholder, size = 'sm', className, disabled, ...rest }: Props) {
  const hasEmptyOption = options.some((o) => o.value === '');
  const known = options.some((o) => o.value === value);
  const current = value === '' ? (hasEmptyOption ? EMPTY : '') : known ? value : '';
  return (
    <Select value={current} onValueChange={(v) => onChange(v === EMPTY ? '' : v)} disabled={disabled}>
      <SelectTrigger size={size} className={className} aria-label={rest['aria-label']}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((o) => (
          <SelectItem key={o.value || EMPTY} value={o.value || EMPTY}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
