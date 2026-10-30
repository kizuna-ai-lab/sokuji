import { View } from 'react-native';
import { CircleAlert, Info } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/** A line the screen needs read: a failure (with an icon, not only red), or a note. */
export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'error'; children: string; className?: string }) {
  const error = tone === 'error';
  return (
    <View role={error ? 'alert' : undefined} className={cn('flex-row items-start gap-2', className)}>
      <Icon as={error ? CircleAlert : Info} size={18} className={cn('mt-0.5', error ? 'text-destructive' : 'text-muted-foreground')} />
      <Text className={cn('flex-1 text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>{children}</Text>
    </View>
  );
}
