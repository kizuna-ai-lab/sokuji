import { useTranslation } from 'react-i18next';
import { searchLanguages, type LanguageOption } from '../i18n/languages';
import { OptionSheet } from './OptionSheet';

const toSheet = (o: LanguageOption) => ({ value: o.code, label: o.name });

/** Every language a side can be, by name; the search also knows English names and codes. */
export function LanguagePicker({ visible, title, options, value, onPick, onClose }: {
  visible: boolean;
  title: string;
  options: readonly LanguageOption[];
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <OptionSheet
      visible={visible}
      title={title}
      options={options.map(toSheet)}
      value={value}
      filter={(query) => searchLanguages(options, query).map(toSheet)}
      searchLabel={t('mobile.languages.search')}
      emptyLabel={t('mobile.languages.none')}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
