import * as React from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

// From about the first accessibility size the title and the action stop sharing a line.
const STACK_FROM_FONT_SCALE = 1.35;

/**
 * A sheet's own bar: the title and an action at the end (Close). A sheet is
 * its own window above the navigator, so the system's bar is not there; the
 * screens under that bar have no header of their own.
 */
export function ScreenHeader({ title, end }: { title: string; end?: React.ReactNode }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_FROM_FONT_SCALE;
  return (
    <View className={cn('px-2 pb-2', stacked ? 'gap-1' : 'min-h-12 flex-row items-center gap-1')}>
      {/* At most three lines, so a long title cannot push the content away; read in full. */}
      <Text role="heading" numberOfLines={3} accessibilityLabel={title} className={cn('text-xl font-semibold', stacked ? 'px-2' : 'flex-1 px-2')}>{title}</Text>
      {end ? <View className={cn(stacked && 'self-start')}>{end}</View> : null}
    </View>
  );
}

/**
 * A screen under the system's navigation bar: its content, scrolling so that
 * large text never pushes anything out of reach, kept off the gesture bar and
 * the rounded corners. The bar itself (title, Back) is the navigator's.
 */
export function Screen({ children, scroll = true }: {
  children: React.ReactNode;
  /** False for a screen whose content is its own list. */
  scroll?: boolean;
}) {
  return (
    <SafeAreaView className="bg-background w-full flex-1" edges={['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView className="flex-1" contentContainerClassName="gap-6 pb-8 pt-4" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}
