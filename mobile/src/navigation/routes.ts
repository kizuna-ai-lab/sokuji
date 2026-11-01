import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SessionSummary } from '../history/store';

/** The screens the signed-in app navigates between, and what each is opened with. */
export type RootStackParamList = {
  Main: undefined;
  Settings: undefined;
  Account: undefined;
  History: undefined;
  Listen: undefined;
  Devices: undefined;
  Usage: undefined;
  Reader: { session: SessionSummary };
  Verify: undefined;
  Password: undefined;
};

export type AppNavigation = NativeStackNavigationProp<RootStackParamList>;

declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
