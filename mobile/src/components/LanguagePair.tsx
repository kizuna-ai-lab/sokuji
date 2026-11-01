import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type SideProps = Omit<React.ComponentProps<typeof Pressable>, 'children' | 'onPress'> & {
  /** The language's name as shown. */
  name: string;
  /** What the side is ("I hear"), read before the name. */
  label: string;
  /** What a press does, read after the name; while locked, why it does nothing. */
  hint: string;
  locked: boolean;
  onPress: () => void;
};

/**
 * One side of the pair: the language's name and a chevron saying it opens a
 * list, one touch target of at least 48 units that grows with the name. The
 * ref reaches the Pressable, so focus can return here when the list closes.
 */
function Side({ name, label, hint, locked, onPress, className, ...props }: SideProps) {
  return (
    <Pressable
      role="button"
      {...props}
      accessibilityLabel={`${label}: ${name}`}
      accessibilityHint={hint}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      className={cn('min-h-12 flex-1 flex-row items-center justify-center gap-1 px-3 py-2', !locked && 'active:bg-accent', className)}
    >
      <Text className={cn('shrink text-center font-medium', locked && 'text-muted-foreground')}>{name}</Text>
      <Icon as={ChevronDown} size={16} className="text-muted-foreground" />
    </Pressable>
  );
}

/**
 * The language pair on the main screen as two choices in one bordered box:
 * what is heard, an arrow, what is read. Each side opens its own list; in a
 * session both are locked and say so. A long name wraps and the box grows;
 * nothing is shrunk or cut.
 */
export function LanguagePair({ source, target, arrow, hearLabel, readLabel, hearHint, readHint, locked, lockedReason, onPressSource, onPressTarget, sourceRef, targetRef, className }: {
  source: string;
  target: string;
  /** From the heard language to the read one: "→", or "←" in a right-to-left layout. */
  arrow: string;
  hearLabel: string;
  readLabel: string;
  hearHint: string;
  readHint: string;
  locked: boolean;
  lockedReason: string;
  onPressSource: () => void;
  onPressTarget: () => void;
  sourceRef?: React.ComponentProps<typeof Pressable>['ref'];
  targetRef?: React.ComponentProps<typeof Pressable>['ref'];
  className?: string;
}) {
  return (
    <View className={cn('border-border bg-background flex-row items-stretch overflow-hidden rounded-md border', className)}>
      <Side ref={sourceRef} name={source} label={hearLabel} hint={locked ? lockedReason : hearHint} locked={locked} onPress={onPressSource} />
      {/* Decoration between the two buttons, hidden from screen readers with its text
          (the sides' labels already say which is which): a stop on it would be one too many. */}
      <View className="justify-center" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text className="text-muted-foreground">{arrow}</Text>
      </View>
      <Side ref={targetRef} name={target} label={readLabel} hint={locked ? lockedReason : readHint} locked={locked} onPress={onPressTarget} />
    </View>
  );
}
