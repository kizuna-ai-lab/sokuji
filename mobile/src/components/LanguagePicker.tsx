import { useMemo, useState } from 'react';
import { FlatList, Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { searchLanguages, type LanguageOption } from '../i18n/languages';
import { Row } from './Row';
import { ScreenHeader } from './ScreenHeader';

/**
 * Every language a side can be, by name, in a sheet with a search field:
 * sixty rows are too many to scroll for one. Picking one closes the sheet.
 */
export function LanguagePicker({ visible, title, options, value, onPick, onClose }: {
  visible: boolean;
  title: string;
  options: readonly LanguageOption[];
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchLanguages(options, query), [options, query]);
  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
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
            placeholder={t('mobile.languages.search')}
            accessibilityLabel={t('mobile.languages.search')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(o) => o.code}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={() => <Separator />}
          ListEmptyComponent={<Text className="text-muted-foreground px-4 py-6">{t('mobile.languages.none')}</Text>}
          renderItem={({ item }) => {
            const on = item.code === value;
            return (
              <Row
                label={item.name}
                role="radio"
                accessibilityState={{ checked: on }}
                chevron={false}
                onPress={() => {
                  setQuery('');
                  onPick(item.code);
                }}
                accessory={<Icon as={Check} size={20} className={cn('text-primary', !on && 'opacity-0')} />}
              />
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}
