import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

// The navigation bars in the app's own colours: global.css's neutral theme
// (React Native Reusables'), light and dark, as hex for the native header.
const light: Theme['colors'] = {
  primary: '#171717',
  background: '#ffffff',
  card: '#ffffff',
  text: '#0a0a0a',
  border: '#e5e5e5',
  notification: '#c92121',
};

const dark: Theme['colors'] = {
  primary: '#fafafa',
  background: '#0a0a0a',
  card: '#0a0a0a',
  text: '#fafafa',
  border: '#2e2e2e',
  notification: '#e04545',
};

export function navigationTheme(scheme: 'light' | 'dark' | null | undefined): Theme {
  return scheme === 'dark'
    ? { ...DarkTheme, colors: dark }
    : { ...DefaultTheme, colors: light };
}
