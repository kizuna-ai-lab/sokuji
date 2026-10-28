import { View } from 'react-native';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/**
 * A labelled text field: the label stays above it while typing (a placeholder
 * would vanish), a hint under it, and its error in the hint's place. `end`
 * sits beside the input (a password's show/hide button).
 */
export function Field({ label, hint, error, end, className, ...input }: React.ComponentProps<typeof Input> & { label: string; hint?: string; error?: string; end?: React.ReactNode }) {
  const field = (
    <Input accessibilityLabel={label} accessibilityHint={error ?? hint} aria-invalid={!!error} className={cn(error && 'border-destructive', end && 'w-auto flex-1')} {...input} />
  );
  return (
    <View className={cn('gap-1.5', className)}>
      {/* Shown, but not a stop of its own for a screen reader: the field reads its label itself. */}
      <Text className="text-sm font-medium" accessibilityElementsHidden importantForAccessibility="no">{label}</Text>
      {end ? (
        <View className="flex-row items-center gap-1">
          {field}
          {end}
        </View>
      ) : (
        field
      )}
      {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : hint ? <Text className="text-muted-foreground text-sm">{hint}</Text> : null}
    </View>
  );
}
