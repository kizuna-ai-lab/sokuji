import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Notice } from '@/components/Notice';
import { useApp } from '../navigation/context';
import type { AppNavigation, RootStackParamList } from '../navigation/routes';
import SessionReader from './SessionReader';
import { useHistoryActions, useSessionLines } from './useHistoryActions';

// A session opened from the history list: the reader, with the session's more
// button (rename, export, delete) in the system's bar.
export default function ReaderScreen() {
  const { history } = useApp();
  const navigation = useNavigation<AppNavigation>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Reader'>>();
  // The session as opened; a rename made here follows in the title.
  const [session, setSession] = useState(params.session);
  const { lines } = useSessionLines();
  const { actions, dialogs, error } = useHistoryActions(history, {
    onRenamed: (id, title) => { if (id === session.id) setSession((s) => ({ ...s, title: title || undefined })); },
    // Deleted from the reader: back to the list.
    onDeleted: (id) => { if (id === session.id) navigation.goBack(); },
  });
  // The bar's button calls the current menu, whichever render it came from.
  const latest = useRef(actions);
  latest.current = actions;
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => latest.current(session) });
  }, [navigation, session]);

  const { name, meta } = lines(session);
  return (
    <>
      <SessionReader store={history} id={session.id} title={name} meta={meta} notice={error ? <Notice tone="error">{error}</Notice> : undefined} />
      {dialogs}
    </>
  );
}
