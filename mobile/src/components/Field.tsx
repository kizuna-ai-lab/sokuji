import { useId } from 'react';
import { View } from 'react-native';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/**
 * A labelled text field: the label stays above it while typing (a placeholder
 * would vanish), a hint under it, and its error in the hint's place.
 */
export function Field({ label, hint, error, className, ...input }: React.ComponentProps<typeof Input> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <View className={cn('gap-1.5', className)}>
      <Label nativeID={id}>{label}</Label>
      <Input aria-labelledby={id} accessibilityLabel={label} accessibilityHint={error ?? hint} aria-invalid={!!error} className={cn(error && 'border-destructive')} {...input} />
      {error ? <Text role="alert" className="text-destructive text-sm">{error}</Text> : hint ? <Text className="text-muted-foreground text-sm">{hint}</Text> : null}
    </View>
  );
}
