import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { conversationExporter, exportWords, type Exporter } from '../../lib/export/exporter';
import type { ConversationInfo } from '../../lib/session/conversationSet';
import type { ConversationViewState } from '../../lib/view/conversationView';
import { getAppVersion } from '../../utils/conversationExport';

/** The export menu's exporter over a conversation view: a new one only when the view's legs or entries change. */
export function useConversationExporter({ legs, entries }: ConversationViewState, info: ConversationInfo | null): Exporter {
  const { t } = useTranslation();
  const words = useMemo(() => exportWords((key, defaultValue) => t(key, defaultValue)), [t]);
  return useMemo(
    () => conversationExporter({ entries, legs, info, words, appVersion: getAppVersion(), now: Date.now }),
    [entries, legs, info, words],
  );
}
