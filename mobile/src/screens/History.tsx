import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Notice } from '@/components/Notice';
import { Row } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { Spinner } from '@/components/Spinner';
import type { SessionSummary } from '../history/store';
import { useApp } from '../navigation/context';
import type { AppNavigation } from '../navigation/routes';
import { useHistoryActions, useSessionLines } from './useHistoryActions';

const RowSeparator = () => <Separator />;

// The sessions on the device, newest first: a row opens the session to read;
// its more button renames, exports or deletes it.
export default function History() {
  const { t } = useTranslation();
  const { history: store } = useApp();
  const navigation = useNavigation<AppNavigation>();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  // The list could not be read: not the same as having no sessions.
  const [listFailed, setListFailed] = useState(false);
  const { lines } = useSessionLines();

  const load = useCallback(async () => {
    try {
      setSessions(await store.list());
      setListFailed(false);
    } catch (err) {
      console.warn(`history list: ${err instanceof Error ? err.message : String(err)}`);
      setListFailed(true);
      setSessions((s) => s ?? []);
    }
  }, [store]);
  // Loaded when the screen shows, and again when the reader comes back to it (a rename or delete made there).
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const { actions, dialogs, error, clearError } = useHistoryActions(store, {
    onRenamed: () => load(),
    onDeleted: (id) => {
      // Gone from the list at once: a tap before the reload finishes must not open it.
      setSessions((list) => list?.filter((x) => x.id !== id) ?? list);
      return load();
    },
  });

  return (
    <Screen scroll={false}>
      {error ? <Notice tone="error" className="px-4 pb-2">{error}</Notice> : null}
      {/* A reload that failed over a list already shown: the list stays, and says it may be out of date. */}
      {!error && listFailed && (sessions?.length ?? 0) > 0 ? <Notice tone="error" className="px-4 pb-2">{t('mobile.common.failed')}</Notice> : null}
      <FlatList
        className="flex-1"
        data={sessions ?? []}
        keyExtractor={(s) => s.id}
        ItemSeparatorComponent={RowSeparator}
        ListEmptyComponent={
          sessions === null ? (
            <Spinner size="large" className="py-10" />
          ) : listFailed ? (
            <View className="gap-3 px-4 py-10">
              <Notice tone="error">{t('mobile.common.failed')}</Notice>
              <Button variant="outline" onPress={() => { setSessions(null); void load(); }}>
                <Text>{t('common.retry')}</Text>
              </Button>
            </View>
          ) : (
            <Text className="text-muted-foreground px-6 py-10 text-center">{t('mobile.history.empty')}</Text>
          )
        }
        renderItem={({ item }) => {
          const { name: label, meta } = lines(item);
          return (
            // Reading is what a row is for: the row (label, date, padding, chevron) opens the
            // reader; the more button beside it, a separate target, holds the rest. It sits at
            // the row's top, beside the title: centred beside a long title at AX5 it was off screen.
            <View className="flex-row items-start pe-1 pt-1">
              <Row
                className="flex-1 pe-1"
                label={label}
                value={meta}
                // A failure shown for another session (an export, a delete) is not this one's.
                onPress={() => { clearError(); navigation.navigate('Reader', { session: item }); }}
              />
              {actions(item)}
            </View>
          );
        }}
      />
      {dialogs}
    </Screen>
  );
}
