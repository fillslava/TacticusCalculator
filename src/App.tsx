import { ImportBar } from './ui/components/ImportBar';
import { BuildEditor } from './ui/components/BuildEditor';
import { TargetEditor } from './ui/components/TargetEditor';
import { RotationEditor } from './ui/components/RotationEditor';
import { DamageResult } from './ui/components/DamageResult';
import { CharacterComparison } from './ui/components/CharacterComparison';
import { SyncReport } from './ui/components/SyncReport';
import { LanguageSelector } from './ui/components/LanguageSelector';
import { TeamComposer } from './ui/components/TeamComposer';
import { TeamRotationEditor } from './ui/components/TeamRotationEditor';
import { TeamDamageResult } from './ui/components/TeamDamageResult';
import { MapPage } from './ui/pages/MapPage';
import { useApp } from './state/store';
import { useT } from './lib/i18n';
import './engine/traits';

export function App() {
  const t = useT();
  const page = useApp((s) => s.page);
  const setPage = useApp((s) => s.setPage);
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

      <nav className="mb-4 flex gap-1 border-b border-bg-subtle text-sm">
        <PageTab
          active={page === 'single'}
          onClick={() => setPage('single')}
          label={t('page.single')}
        />
        <PageTab
          active={page === 'team'}
          onClick={() => setPage('team')}
          label={t('page.team')}
        />
        <PageTab
          active={page === 'map'}
          onClick={() => setPage('map')}
          label={t('page.map')}
        />
      </nav>

      {page === 'single' ? (
        <SinglePage />
      ) : page === 'team' ? (
        <TeamPage />
      ) : (
        <MapPage />
      )}
    </main>
  );
}

function SinglePage() {
  return (
    <>
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
    </>
  );
}

function TeamPage() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <ImportBar />
        <TeamComposer />
        <TargetEditor />
      </div>
      <div className="flex flex-col gap-4">
        <TeamRotationEditor />
        <TeamDamageResult />
      </div>
    </div>
  );
}

function PageTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  const base =
    'rounded-t border-b-2 px-4 py-2 transition-colors';
  const cls = active
    ? `${base} border-accent text-accent`
    : `${base} border-transparent text-slate-400 hover:text-slate-200`;
  return (
    <button type="button" onClick={onClick} className={cls}>
      {label}
    </button>
  );
}
