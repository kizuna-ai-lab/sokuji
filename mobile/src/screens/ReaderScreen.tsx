import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useNavigation, usePreventRemove, useRoute, type RouteProp } from '@react-navigation/native';
import { Notice } from '@/components/Notice';
import { leaveState } from '@/lib/leave';
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
  // Deleted from the reader: back to the list, once the delete has released its hold.
  const [leaving, setLeaving] = useState(false);
  const { actions, dialogs, error, busy } = useHistoryActions(history, {
    onRenamed: (id, title) => { if (id === session.id) setSession((s) => ({ ...s, title: title || undefined })); },
    onDeleted: (id) => { if (id === session.id) setLeaving(true); },
  });
  // A rename or delete being saved holds the page: leaving before the write
  // lands would show the list its old state (History reloads when it is back).
  const { prevent, goBack } = leaveState({ holding: busy, leaving });
  usePreventRemove(prevent, () => {});
  useEffect(() => {
    navigation.setOptions({ headerBackVisible: !prevent, gestureEnabled: !prevent });
  }, [navigation, prevent]);
  useEffect(() => {
    if (goBack) navigation.goBack();
  }, [goBack, navigation]);
  // The bar's button calls the current menu, whichever render it came from;
  // set again when the system text size changes, so the button is drawn at its new size.
  const { fontScale } = useWindowDimensions();
  const latest = useRef(actions);
  latest.current = actions;
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => latest.current(session) });
  }, [navigation, session, fontScale]);

  const { name, meta } = lines(session);
  return (
    <>
      <SessionReader store={history} id={session.id} title={name} meta={meta} notice={error ? <Notice tone="error">{error}</Notice> : undefined} />
      {dialogs}
    </>
  );
}
