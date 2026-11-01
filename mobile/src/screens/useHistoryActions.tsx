import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { Ellipsis, FileJson, FileText, Pencil, Trash2 } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Spinner } from '@/components/Spinner';
import { useBusy } from '@/lib/useBusy';
import { useIconSize } from '@/lib/useIconSize';
import { languageName } from '../i18n/languages';
import { exportJson, exportText } from '../history/export';
import { shareExport } from '../history/share';
import type { HistoryStore, SessionSummary } from '../history/store';
import { pairLabel } from './mainText';
import { sessionLines } from './historyText';
import { SONIOX_STT_MODEL } from '@shared/providers/soniox/sttStream';

/** A session's name and its line of date, pair and length, in the interface language. */
export function useSessionLines() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.replace('_', '-');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const ui = i18n.language;
  const autoLabel = t('common.autoDetect');
  const lines = (s: SessionSummary) =>
    sessionLines(s, {
      when: (ms) => when.format(new Date(ms)),
      pair: (source, target) => pairLabel(languageName(source, ui, autoLabel), languageName(target, ui), i18n.dir(ui) === 'rtl'),
      minutes: (n) => t('mobile.history.minutes', { minutes: n }),
    });
  return { lines, when };
}

/**
 * Rename, export (.txt, .json) and delete a session, behind a more button:
 * the list has one on each row, the reader one in its bar. The dialogs and the
 * failure line are the caller's to place; `onRenamed` and `onDeleted` say what
 * changed, after the store has it.
 */
export function useHistoryActions(store: HistoryStore, { onRenamed, onDeleted }: {
  onRenamed?: (id: string, title: string) => void | Promise<void>;
  onDeleted?: (id: string) => void | Promise<void>;
}): { actions: (item: SessionSummary) => ReactNode; dialogs: ReactNode; error: string; clearError: () => void } {
  const { t } = useTranslation();
  const { lines, when } = useSessionLines();
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [renameError, setRenameError] = useState('');
  const [, runShare] = useBusy();
  const [saving, runSave] = useBusy();
  const [, runDelete] = useBusy();
  const moreIcon = useIconSize(22);
  // The detail is for the log; the screen says it in words (design scope: no raw errors).
  const fail = (what: string) => (err: unknown) => {
    console.warn(`history ${what}: ${err instanceof Error ? err.message : String(err)}`);
    return t('mobile.common.failed');
  };

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
      const next = title.trim();
      try {
        await store.rename(renaming.id, next);
        setRenaming(null);
        await onRenamed?.(renaming.id, next);
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
        await onDeleted?.(s.id);
      } catch (err) {
        setError(fail('delete')(err));
      }
    });
  }

  const actions = (item: SessionSummary) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" accessibilityLabel={t('mobile.history.actions')}>
          <Icon as={Ellipsis} size={moreIcon} className="text-muted-foreground" />
        </Button>
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

  const dialogs = (
    <>
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
        description={deleting ? lines(deleting).name : undefined}
        confirmLabel={t('mobile.history.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (deleting) deleteNow(deleting);
        }}
      />
    </>
  );

  return { actions, dialogs, error, clearError: () => setError('') };
}
