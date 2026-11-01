import * as React from 'react';
import { Pressable, View, type TextLayoutEvent } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useIconSize } from '@/lib/useIconSize';
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
  /** The chevron's size, following the text size. */
  iconSize: number;
  /** The name did not fit on one line: the caller gives the pair more room. */
  onWrap?: () => void;
  /** Changes whenever the name must be measured afresh (a new layout, text size or width). */
  measureKey: string;
};

/**
 * One side of the pair: a ghost Button (the registry's, so it presses, dims
 * and reads like every other button) with the language's name and a chevron
 * saying it opens a list; at least 48 units tall, growing with the name. The
 * ref reaches the Pressable, so focus can return here when the list closes.
 */
function Side({ name, label, hint, locked, onPress, iconSize, onWrap, measureKey, className, ...props }: SideProps) {
  const onTextLayout = (e: TextLayoutEvent) => {
    if (e.nativeEvent.lines.length > 1) onWrap?.();
  };
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
      className={cn('gap-1 rounded-none px-2 py-2', className)}
    >
      {/* Remounted on each change of layout, text size or width: a text laid out again
          in place did not always report its lines (iOS: the bar stayed on a layout
          whose names broke inside a word after the system text size changed). */}
      <Text key={measureKey} className="shrink" onTextLayout={onTextLayout}>{name}</Text>
      <Icon as={ChevronDown} size={iconSize} className="text-muted-foreground" />
    </Button>
  );
}

/**
 * The language pair on the main screen as two choices in one bordered box:
 * what is heard, an arrow, what is read. Each side opens its own list; in a
 * session both are locked and say so. Side by side ('row') the sides share
 * the width; one above the other ('column') each has it all, for the largest
 * text sizes and names that would otherwise break inside a word. A name that
 * does not fit on one line is reported through `onWrap`; nothing is shrunk or cut.
 */
export function LanguagePair({ source, target, arrow, layout, onWrap, measureKey, hearLabel, readLabel, hearHint, readHint, locked, lockedReason, onPressSource, onPressTarget, sourceRef, targetRef, className }: {
  source: string;
  target: string;
  /** From the heard language to the read one: "→", or "←" in a right-to-left layout; "↓" when stacked. */
  arrow: string;
  layout: 'row' | 'column';
  onWrap?: () => void;
  measureKey: string;
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
  const column = layout === 'column';
  const iconSize = useIconSize(16);
  // Side by side, each side starts from its name's width and the spare width is
  // shared: a long name beside a short one fits where equal halves would not.
  const side = column ? 'self-stretch' : 'grow shrink basis-auto';
  return (
    <View className={cn('border-border bg-background overflow-hidden rounded-md border', column ? 'items-stretch' : 'flex-row items-stretch', className)}>
      <Side ref={sourceRef} className={side} name={source} label={hearLabel} hint={locked ? lockedReason : hearHint} locked={locked} onPress={onPressSource} iconSize={iconSize} onWrap={onWrap} measureKey={measureKey} />
      {/* Decoration between the two buttons, hidden from screen readers with its text
          (the sides' labels already say which is which): a stop on it would be one too many. */}
      <View className={column ? 'items-center' : 'justify-center'} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text className="text-muted-foreground">{column ? '↓' : arrow}</Text>
      </View>
      <Side ref={targetRef} className={side} name={target} label={readLabel} hint={locked ? lockedReason : readHint} locked={locked} onPress={onPressTarget} iconSize={iconSize} onWrap={onWrap} measureKey={measureKey} />
    </View>
  );
}
