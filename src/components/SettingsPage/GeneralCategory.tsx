// src/components/SettingsPage/GeneralCategory.tsx
//
// "General": today's help section as it is (interface language, appearance,
// updates, diagnostic logs, run setup again, the guide, support, version).
import HelpSection from '../Settings/sections/HelpSection';
import type { CategoryBodyProps } from './SettingsPage';

export function GeneralCategory({ locked }: CategoryBodyProps) {
  return <HelpSection isSessionActive={locked} />;
}
