import { ImportBar } from './ui/components/ImportBar';
import { BuildEditor } from './ui/components/BuildEditor';
import { TargetEditor } from './ui/components/TargetEditor';
import { RotationEditor } from './ui/components/RotationEditor';
import { DamageResult } from './ui/components/DamageResult';
import { CharacterComparison } from './ui/components/CharacterComparison';
import { SyncReport } from './ui/components/SyncReport';
import './engine/traits';

export function App() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl p-4 md:p-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">
          <span className="text-accent">Tacticus</span> Damage Calculator
        </h1>
        <span className="text-xs text-slate-500">
          formula: HDTW · engine v0.1
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <ImportBar />
          <SyncReport />
          <BuildEditor />
          <TargetEditor />
          <RotationEditor />
        </div>
        <div className="flex flex-col gap-4">
          <DamageResult />
        </div>
      </div>

      <div className="mt-4">
        <CharacterComparison />
      </div>
    </main>
  );
}
