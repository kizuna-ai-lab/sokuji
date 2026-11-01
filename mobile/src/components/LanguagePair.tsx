import * as React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
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
 * One side of the pair: a ghost Button (the registry's, so it presses, dims
 * and reads like every other button) with the language's name and a chevron
 * saying it opens a list; at least 48 units tall, growing with the name. The
 * ref reaches the Pressable, so focus can return here when the list closes.
 */
function Side({ name, label, hint, locked, onPress, className, ...props }: SideProps) {
  return (
    <Button
      variant="ghost"
      {...props}
      accessibilityLabel={`${label}: ${name}`}
      accessibilityHint={hint}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      // Squared off: the box around the pair carries the rounding.
      className={cn('flex-1 gap-1 rounded-none px-3 py-2', className)}
    >
      <Text className="shrink">{name}</Text>
      <Icon as={ChevronDown} size={16} className="text-muted-foreground" />
    </Button>
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
