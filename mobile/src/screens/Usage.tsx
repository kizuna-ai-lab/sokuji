import { useCallback, useEffect, useState } from 'react';
import { Button, FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fetchLedger, type LedgerCursor, type LedgerGroup } from '../account/ledger';

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
  const [error, setError] = useState('');
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' });
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
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text accessibilityRole="button" style={styles.link} onPress={onBack}>‹ {t('mobile.common.back')}</Text>
        <Text style={styles.title}>{t('mobile.account.usage')}</Text>
        <Text style={styles.link}> </Text>
      </View>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>
                {item.kind === 'session'
                  ? `${t('mobile.usage.session')}${item.textOnly ? ` · ${t('mobile.usage.textOnly')}` : ''}${item.durationSeconds !== null ? ` · ${duration(item.durationSeconds)}` : ''}`
                  : t(KIND_KEY[item.kind] ?? 'mobile.usage.kind.adjustment')}
              </Text>
              <Text style={styles.when}>{when.format(new Date(item.occurredAt))}</Text>
            </View>
            <Text style={[styles.amount, item.amountUsd > 0 && styles.credit]}>{money.format(item.amountUsd)}</Text>
          </View>
        )}
        ListFooterComponent={next ? <Button title={t('mobile.usage.loadMore')} disabled={busy} onPress={() => load(next)} /> : undefined}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%', padding: 12, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: '600', fontSize: 17 },
  link: { color: '#1e63c4', minWidth: 60 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5', gap: 8 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 15 },
  when: { fontSize: 12, color: '#777' },
  amount: { fontVariant: ['tabular-nums'], fontSize: 15 },
  credit: { color: '#1b7f3b' },
  error: { color: '#c0392b' },
});
