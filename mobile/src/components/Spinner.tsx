import { useContext } from 'react';
import { ActivityIndicator } from 'react-native';
import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/** The platform's activity indicator in the surrounding text colour (inside a button, the button's). */
export function Spinner({ className, size = 'small' }: { className?: string; size?: 'small' | 'large' }) {
  const textClass = useContext(TextClassContext);
  return <ActivityIndicator size={size} className={cn('text-muted-foreground', textClass, className)} />;
}
