import { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { Ellipsis, FileJson, FileText, Pencil, Trash2 } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { Text } from '@/components/ui/text';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Row } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { Spinner } from '@/components/Spinner';
import { useBusy } from '@/lib/useBusy';
import { languageName } from '../i18n/languages';
import { exportJson, exportText } from '../history/export';
import { shareExport } from '../history/share';
import type { HistoryStore, SessionSummary } from '../history/store';
import { pairLabel } from './mainText';
import { sessionLines } from './historyText';
import { SONIOX_STT_MODEL } from '@shared/providers/soniox/sttStream';

const RowSeparator = () => <Separator />;

// The sessions on the device, newest first: rename, export, delete.
export default function History({ store, onBack }: { store: HistoryStore; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.replace('_', '-');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [renameError, setRenameError] = useState('');
  // The list could not be read: not the same as having no sessions.
  const [listFailed, setListFailed] = useState(false);
  const [, runShare] = useBusy();
  const [saving, runSave] = useBusy();
  const [, runDelete] = useBusy();
  // The detail is for the log; the screen says it in words (design scope: no raw errors).
  const fail = (what: string) => (err: unknown) => {
    console.warn(`history ${what}: ${err instanceof Error ? err.message : String(err)}`);
    return t('mobile.common.failed');
  };

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
  useEffect(() => {
    void load();
  }, [load]);

  const ui = i18n.language;
  const autoLabel = t('common.autoDetect');
  const lines = (s: SessionSummary) =>
    sessionLines(s, {
      when: (ms) => when.format(new Date(ms)),
      pair: (source, target) => pairLabel(languageName(source, ui, autoLabel), languageName(target, ui), i18n.dir(ui) === 'rtl'),
      minutes: (n) => t('mobile.history.minutes', { minutes: n }),
    });
  const name = (s: SessionSummary) => lines(s).name;

  async function share(s: SessionSummary, kind: 'txt' | 'json') {
    setError('');
    try {
      const full = await store.load(s.id);
      if (!full) return;
      const meta = {
        exportedAt: Date.now(),
        appVersion: Constants.expoConfig?.version ?? null,
        provider: 'soniox',
        models: { asr: SONIOX_STT_MODEL },
      };
      const body = kind === 'txt'
        ? exportText(
            full,
            {
              me: t('mainPanel.export.speakerYou'),
              other: t('mainPanel.export.speakerOther'),
              noTranslation: t('mainPanel.export.noTranslation'),
              noSource: t('mainPanel.export.noSource'),
              person: (n) => t('mainPanel.displayMode.person', { n }),
            },
            {
              title: t('mainPanel.export.headerTitle'),
              generated: t('mainPanel.export.headerGenerated'),
              provider: t('mainPanel.export.headerProvider'),
              models: t('mainPanel.export.headerModels'),
              source: t('mobile.main.hear'),
              target: t('mobile.main.read'),
              narrowed: t('mainPanel.export.headerNarrowed'),
            },
            meta,
          )
        : exportJson(full, meta);
      await shareExport(full, kind, body);
    } catch (err) {
      setError(fail('export')(err));
    }
  }

  function saveTitle() {
    // One save at a time (the button and the keyboard's Done both save). An
    // empty name gives the session back its date as its name. A failure keeps
    // the dialog and what was typed, and says so there.
    void runSave(async () => {
      if (!renaming) return;
      setRenameError('');
      try {
        await store.rename(renaming.id, title.trim());
        setRenaming(null);
        await load();
      } catch (err) {
        setRenameError(fail('rename')(err));
      }
    });
  }

  function deleteNow(s: SessionSummary) {
    void runDelete(async () => {
      setError('');
      try {
        await store.delete(s.id);
        await load();
      } catch (err) {
        setError(fail('delete')(err));
      }
    });
  }

  return (
    <Screen title={t('mobile.history.title')} onBack={onBack} scroll={false}>
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
            // The whole row opens what can be done with the session.
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Row label={label} value={meta} accessibilityHint={t('mobile.history.actions')} accessory={<Icon as={Ellipsis} size={20} className="text-muted-foreground" />} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onPress={() => { setTitle(item.title ?? ''); setRenameError(''); setRenaming(item); }}>
                  <Icon as={Pencil} size={20} />
                  <Text>{t('mobile.history.rename')}</Text>
                </DropdownMenuItem>
                <DropdownMenuItem onPress={() => { void runShare(() => share(item, 'txt')); }}>
                  <Icon as={FileText} size={20} />
                  <Text>{t('mobile.history.export')} (.txt)</Text>
                </DropdownMenuItem>
                <DropdownMenuItem onPress={() => { void runShare(() => share(item, 'json')); }}>
                  <Icon as={FileJson} size={20} />
                  <Text>{t('mobile.history.export')} (.json)</Text>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onPress={() => setDeleting(item)}>
                  <Icon as={Trash2} size={20} className="text-destructive" />
                  <Text>{t('mobile.history.delete')}</Text>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }}
      />
      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle className="pr-12">{t('mobile.history.rename')}</DialogTitle>
          </DialogHeader>
          <Field
            label={t('mobile.history.name')}
            hint={t('mobile.history.renameHint')}
            placeholder={renaming ? when.format(new Date(renaming.startedAt)) : undefined}
            value={title}
            onChangeText={setTitle}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={saveTitle}
          />
          {renameError ? <Notice tone="error">{renameError}</Notice> : null}
          <DialogFooter>
            <Button variant="outline" onPress={() => setRenaming(null)}>
              <Text>{t('common.cancel')}</Text>
            </Button>
            <Button disabled={saving} accessibilityState={{ busy: saving }} onPress={saveTitle}>
              {saving ? <Spinner /> : null}
              <Text>{t('mobile.history.rename')}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null); }}
        title={t('mobile.history.delete')}
        description={deleting ? name(deleting) : undefined}
        confirmLabel={t('mobile.history.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (deleting) deleteNow(deleting);
        }}
      />
    </Screen>
  );
}
