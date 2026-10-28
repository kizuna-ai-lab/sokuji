import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text as Span, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/ScreenHeader';
import { Spinner } from '@/components/Spinner';
import { cn } from '@/lib/utils';
import { entriesOf } from '../history/export';
import { readingLines, type ReadingLine } from '../history/reading';
import type { HistoryStore, StoredSession } from '../history/store';
import { useSettings } from '../store/useSettings';
import { lineHeight, SIZES, SOURCE_MAX_SCALE, TRANSLATION_MAX_SCALE } from '@/lib/subtitleText';

/**
 * A saved session to read, top to bottom: the translation first, the source
 * under it when both languages are shown, the time where the minute or the
 * speaker changes. The text is selectable, so a long press copies it. Local
 * only: nothing is sent anywhere.
 */
export default function SessionReader({ store, id, title, meta, onBack, actions, notice }: {
  store: HistoryStore;
  id: string;
  title: string;
  /** The row's second line: when, the pair, how long. */
  meta: string;
  onBack: () => void;
  /** The header's more button: rename, export, delete. */
  actions: React.ReactNode;
  /** What one of those actions has to say (a failed export or delete), under the header. */
  notice?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const size = SIZES[settings.textSize];
  const time = new Intl.DateTimeFormat(i18n.language.replace('_', '-'), { timeStyle: 'short' });
  const [session, setSession] = useState<StoredSession | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      // A file that is gone or cannot be read is a failure, not an empty session.
      const loaded = await store.load(id);
      if (loaded === null) setFailed(true);
      else setSession(loaded);
    } catch (err) {
      console.warn(`history read: ${err instanceof Error ? err.message : String(err)}`);
      setFailed(true);
    }
  }, [store, id]);
  useEffect(() => {
    void load();
  }, [load]);

  const lines = useMemo(() => (session ? readingLines(entriesOf(session)) : []), [session]);

  const renderLine = ({ item }: { item: ReadingLine }) => (
    <View className="gap-1 px-4 py-3">
      {item.showTime ? (
        <Text className="text-muted-foreground text-sm" maxFontSizeMultiplier={SOURCE_MAX_SCALE}>
          {[time.format(new Date(item.t)), item.person !== undefined ? t('mainPanel.displayMode.person', { n: item.person }) : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      <Text selectable className="font-medium" style={{ fontSize: size.translation, lineHeight: lineHeight(size.translation) }} maxFontSizeMultiplier={TRANSLATION_MAX_SCALE}>
        {item.translation.map((r) => (
          <Span key={r.key} className={cn(!r.final && 'text-muted-foreground')}>{r.text}</Span>
        ))}
      </Text>
      {settings.bilingual ? (
        <Text selectable className="text-muted-foreground" style={{ fontSize: size.source, lineHeight: lineHeight(size.source) }} maxFontSizeMultiplier={SOURCE_MAX_SCALE}>
          {item.source.map((r) => (
            <Span key={r.key}>{r.text}</Span>
          ))}
        </Text>
      ) : null}
      {/* Not only fainter: said in words, so it reads the same in either theme and to a screen reader. */}
      {item.unfinished ? <Text className="text-muted-foreground text-xs font-medium">{t('mobile.history.unfinished')}</Text> : null}
    </View>
  );

  return (
    <Screen title={title} onBack={onBack} end={actions} scroll={false}>
      <Text className="text-muted-foreground px-4 pb-2 text-sm">{meta}</Text>
      {notice ? <View className="px-4 pb-2">{notice}</View> : null}
      {session === undefined && !failed ? <Spinner size="large" className="py-10" /> : null}
      {failed ? (
        <View className="gap-3 px-4 py-6">
          <Notice tone="error">{t('mobile.common.failed')}</Notice>
          <Button variant="outline" onPress={() => { setSession(undefined); void load(); }}>
            <Text>{t('common.retry')}</Text>
          </Button>
        </View>
      ) : null}
      {session !== undefined && !failed ? (
        <FlatList
          className="flex-1"
          data={lines}
          keyExtractor={(l) => l.id}
          renderItem={renderLine}
          initialNumToRender={20}
          ListEmptyComponent={<Text className="text-muted-foreground px-6 py-10 text-center">{t('mobile.history.nothingHeard')}</Text>}
        />
      ) : null}
    </Screen>
  );
}
