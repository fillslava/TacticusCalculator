import { useApp } from '../../state/store';
import { LANGUAGES, useT, type Lang } from '../../lib/i18n';

export function LanguageSelector() {
  const { language, setLanguage } = useApp();
  const t = useT();
  return (
    <label className="flex items-center gap-1 text-xs text-slate-400">
      <span className="uppercase tracking-wide">{t('lang.label')}</span>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as Lang)}
        className="rounded bg-bg-base px-1.5 py-0.5 text-xs text-slate-200"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
