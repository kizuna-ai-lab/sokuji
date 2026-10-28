import { useMemo, useRef, useState } from 'react';
import { FlatList, Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PortalHost } from '@rn-primitives/portal';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { Row } from './Row';
import { ScreenHeader } from './ScreenHeader';

export type SheetOption = { value: string; label: string; description?: string };

const RowSeparator = () => <Separator />;

/**
 * Where a dialog opened from inside the sheet renders. The sheet is its own
 * native window (on Android a dialog window), above the app's root portal, so
 * a dialog drawn there would sit behind it.
 */
export const SHEET_PORTAL = 'option-sheet';

/**
 * A long list to choose one from, in a sheet with a search field: too many
 * rows to scroll for one. The chosen one is checked. `onPick` reports the
 * choice; the caller closes the sheet (`visible`), as it does for `onClose`.
 */
export function OptionSheet({ visible, title, options, value, filter, searchLabel, emptyLabel, onPick, onClose, note, renderAction }: {
  visible: boolean;
  title: string;
  options: readonly SheetOption[];
  value: string;
  /** The options a query keeps; by default those whose label or description contains it. */
  filter?: (query: string) => readonly SheetOption[];
  searchLabel: string;
  emptyLabel: string;
  onPick: (value: string) => void;
  onClose: () => void;
  /** A line under the search field (what an action costs, say). */
  note?: React.ReactNode;
  /** A button beside each row, a separate target from choosing the row (a voice's preview). */
  renderAction?: (option: SheetOption) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const list = useRef<FlatList<SheetOption>>(null);
  const shown = useMemo(() => {
    if (filter) return filter(query);
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => [o.label, o.description ?? ''].some((s) => s.toLowerCase().includes(q))) : options;
  }, [filter, options, query]);
  const close = () => {
    setQuery('');
    onClose();
  };
  // The sheet opens at the current choice, not at the top of a long list.
  const showCurrent = () => {
    const index = shown.findIndex((o) => o.value === value);
    if (index > 0) list.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close} onShow={showCurrent}>
      <SafeAreaView className="bg-background flex-1" edges={['top', 'bottom', 'left', 'right']}>
        <ScreenHeader
          title={title}
          end={
            <Button variant="ghost" onPress={close}>
              <Text>{t('common.close')}</Text>
            </Button>
          }
        />
        <View className="px-4 pb-2">
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={searchLabel}
            accessibilityLabel={searchLabel}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {note ? <View className="pt-2">{note}</View> : null}
        </View>
        <FlatList
          ref={list}
          data={shown}
          // Every row is drawn, so the current one can be scrolled to at once (the longest list is about 150 voices).
          initialNumToRender={shown.length}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          }}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={RowSeparator}
          ListEmptyComponent={<Text className="text-muted-foreground px-4 py-6">{emptyLabel}</Text>}
          renderItem={({ item }) => {
            const on = item.value === value;
            const row = (
              <Row
                label={item.label}
                value={item.description}
                role="radio"
                accessibilityState={{ checked: on }}
                chevron={false}
                onPress={() => {
                  setQuery('');
                  onPick(item.value);
                }}
                accessory={<Icon as={Check} size={20} className={cn('text-primary', !on && 'opacity-0')} />}
              />
            );
            if (!renderAction) return row;
            return (
              <View className="flex-row items-center pe-1">
                <View className="flex-1">{row}</View>
                {renderAction(item)}
              </View>
            );
          }}
        />
      </SafeAreaView>
      <PortalHost name={SHEET_PORTAL} />
    </Modal>
  );
}
