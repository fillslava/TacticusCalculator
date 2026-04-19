import { ImportBar } from './ui/components/ImportBar';
import { BuildEditor } from './ui/components/BuildEditor';
import { TargetEditor } from './ui/components/TargetEditor';
import { RotationEditor } from './ui/components/RotationEditor';
import { DamageResult } from './ui/components/DamageResult';
import { CharacterComparison } from './ui/components/CharacterComparison';
import { SyncReport } from './ui/components/SyncReport';
import { LanguageSelector } from './ui/components/LanguageSelector';
import { useT } from './lib/i18n';
import './engine/traits';

export function App() {
  const t = useT();
  return (
    <main className="mx-auto min-h-screen max-w-6xl p-4 md:p-8">
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-3xl font-bold">
          <span className="text-accent">Tacticus</span>{' '}
          {t('app.titleSuffix')}
        </h1>
        <div className="flex items-center gap-4">
          <LanguageSelector />
          <span className="hidden text-xs text-slate-500 md:inline">
            {t('app.subtitle')}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <ImportBar />
          <SyncReport />
          <BuildEditor />
          <TargetEditor />
        </div>
        <div className="flex flex-col gap-4">
          <RotationEditor />
          <DamageResult />
        </div>
      </div>

      <div className="mt-4">
        <CharacterComparison />
      </div>
    </main>
  );
}
