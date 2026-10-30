import { View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { Row, RowGroup } from './Row';

export type Choice<T extends string> = { value: T; label: string; description?: string };

/**
 * A short set of options, one per row, top to bottom: no fixed-width segments
 * for large text to squeeze out. The chosen one carries a check, not only a
 * colour, and reads as a selected radio button.
 */
export function ChoiceList<T extends string>({ title, footer, choices, value, onChange, disabled, disabledReason }: {
  title: string;
  footer?: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <View role="radiogroup" accessibilityLabel={title}>
      <RowGroup title={title} footer={disabled && disabledReason ? disabledReason : footer}>
        {choices.map((c) => {
          const on = c.value === value;
          return (
            <Row
              key={c.value}
              label={c.label}
              value={c.description}
              role="radio"
              accessibilityState={{ checked: on }}
              disabled={disabled}
              chevron={false}
              onPress={() => { if (!on) onChange(c.value); }}
              accessory={<Icon as={Check} size={20} className={cn('text-primary', !on && 'opacity-0')} />}
            />
          );
        })}
      </RowGroup>
    </View>
  );
}
