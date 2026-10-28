import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/ScreenHeader';
import { Spinner } from '@/components/Spinner';
import { cn } from '@/lib/utils';
import { fetchLedger, type LedgerCursor, type LedgerGroup } from '../account/ledger';
import { formatUsd } from '../account/money';

const KIND_KEY: Record<string, string> = {
  topup: 'mobile.usage.kind.topup',
  grant: 'mobile.usage.kind.grant',
  adjustment: 'mobile.usage.kind.adjustment',
  refund: 'mobile.usage.kind.refund',
  expired: 'mobile.usage.kind.expired',
  voice_preview: 'mobile.usage.kind.voicePreview',
};

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// The ledger as the website's records card shows it: newest first, a page at a time.
export default function Usage({ token, onBack, onSignInRequired }: { token: string; onBack: () => void; onSignInRequired: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.replace('_', '-');
  const [groups, setGroups] = useState<LedgerGroup[]>([]);
  const [next, setNext] = useState<LedgerCursor | null>(null);
  const [busy, setBusy] = useState(false);
  // Until the first page has answered, an empty list means "loading", not "nothing".
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const load = useCallback(async (before?: LedgerCursor) => {
    setBusy(true);
    setError('');
    try {
      const page = await fetchLedger({ token, before });
      setGroups((g) => (before ? [...g, ...page.groups] : page.groups));
      setNext(page.next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'sign_in_required') onSignInRequired();
      else {
        console.warn(`ledger: ${message}`);
        setError(message);
      }
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (item: LedgerGroup) =>
    item.kind === 'session'
      ? `${t('mobile.usage.session')}${item.textOnly ? ` · ${t('mobile.usage.textOnly')}` : ''}${item.durationSeconds !== null ? ` · ${duration(item.durationSeconds)}` : ''}`
      : t(KIND_KEY[item.kind] ?? 'mobile.usage.kind.adjustment');

  return (
    <Screen title={t('mobile.account.usage')} onBack={onBack} scroll={false}>
      <FlatList
        className="flex-1"
        data={groups}
        keyExtractor={(g) => g.id}
        ItemSeparatorComponent={() => <Separator />}
        renderItem={({ item }) => (
          // The amount wraps under the label rather than squeezing it when the text is large.
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" accessible>
            <View className="min-w-[60%] flex-1 gap-0.5">
              <Text>{label(item)}</Text>
              <Text className="text-muted-foreground text-sm">{when.format(new Date(item.occurredAt))}</Text>
            </View>
            <Text className={cn('font-medium', item.amountUsd > 0 && 'text-green-700 dark:text-green-400')} style={{ fontVariant: ['tabular-nums'] }}>
              {formatUsd(item.amountUsd)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          busy || !loaded ? <Spinner size="large" className="py-10" /> : !error ? <Text className="text-muted-foreground px-4 py-10 text-center">{t('mobile.usage.empty')}</Text> : undefined
        }
        ListFooterComponent={
          <View className="gap-3 px-4 py-4">
            {error ? <Notice tone="error">{error}</Notice> : null}
            {error ? (
              <Button variant="outline" disabled={busy} onPress={() => load(groups.length > 0 && next ? next : undefined)}>
                {busy ? <Spinner /> : null}
                <Text>{t('common.retry')}</Text>
              </Button>
            ) : next && groups.length > 0 ? (
              <Button variant="outline" disabled={busy} accessibilityState={{ busy }} onPress={() => load(next)}>
                {busy ? <Spinner /> : null}
                <Text>{t('mobile.usage.loadMore')}</Text>
              </Button>
            ) : null}
          </View>
        }
      />
    </Screen>
  );
}
