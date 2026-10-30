import * as React from 'react';
import { I18nManager, ScrollView, useWindowDimensions, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

const Backward = I18nManager.isRTL ? ChevronRight : ChevronLeft;

// From about the first accessibility size the back button and the title stop sharing a line.
const STACK_FROM_FONT_SCALE = 1.35;

/** Back (when there is somewhere to go back to), the title, and an optional action at the end. */
/**
 * Without a title (a screen that shows its own, in its scrolling content),
 * back and the action share one row at every text size.
 */
export function ScreenHeader({ title, onBack, backLabel, end, backDisabled = false }: {
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  end?: React.ReactNode;
  /** Back held while the screen's own request runs (the sign-in flows). */
  backDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const stacked = title !== undefined && fontScale >= STACK_FROM_FONT_SCALE;
  return (
    <View className={cn('px-2 pb-2', stacked ? 'gap-1' : 'min-h-14 flex-row items-center gap-1')}>
      {onBack ? (
        <Button variant="ghost" className="self-start px-2" disabled={backDisabled} onPress={onBack}>
          <Icon as={Backward} size={22} />
          <Text>{backLabel ?? t('mobile.common.back')}</Text>
        </Button>
      ) : null}
      {title !== undefined ? (
        // At most three lines, so a long title cannot push the content away; read in full.
        <Text role="heading" numberOfLines={3} accessibilityLabel={title} className={cn('text-xl font-semibold', stacked ? 'px-2' : 'flex-1 px-2')}>{title}</Text>
      ) : null}
      {end ? <View className={cn(stacked && 'self-start', title === undefined && 'ms-auto')}>{end}</View> : null}
    </View>
  );
}

/** A screen: its header, then its content, scrolling so that large text never pushes anything out of reach. */
export function Screen({ title, onBack, backLabel, end, children, scroll = true }: {
  /** Leave out for a screen whose content carries its title (it scrolls with it). */
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  end?: React.ReactNode;
  children: React.ReactNode;
  /** False for a screen whose content is its own list. */
  scroll?: boolean;
}) {
  return (
    <View className="bg-background w-full flex-1">
      <ScreenHeader title={title} onBack={onBack} backLabel={backLabel} end={end} />
      {scroll ? (
        <ScrollView className="flex-1" contentContainerClassName="gap-6 pb-8 pt-2" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </View>
  );
}
