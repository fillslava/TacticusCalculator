import { useState } from 'react';
import { useApp } from '../../state/store';
import { getPlayer } from '../../api/endpoints';
import { ApiPlayerResponseSchema } from '../../api/types';

export function ImportBar() {
  const { credentials, setCredentials, setPlayer, player, importError, setImportError } = useApp();
  const [busy, setBusy] = useState(false);

  async function loadFromApi() {
    setBusy(true);
    setImportError(null);
    try {
      const res = await getPlayer(credentials);
      setPlayer(res.player);
    } catch (e) {
      setImportError(
        `${(e as Error).message}\n` +
          `If this is a CORS error, run: npm run fetch:player and upload the resulting JSON instead.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadFromFile(file: File) {
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = ApiPlayerResponseSchema.parse(JSON.parse(text));
      setPlayer(parsed.player);
    } catch (e) {
      setImportError(`invalid player JSON: ${(e as Error).message}`);
    }
  }

  return (
    <section className="rounded border border-bg-subtle bg-bg-elevated p-4">
      <h2 className="text-lg font-semibold">Import</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">API Key</span>
          <input
            type="password"
            value={credentials.apiKey}
            onChange={(e) => setCredentials({ apiKey: e.target.value })}
            className="rounded bg-bg-base px-2 py-1 font-mono text-sm"
            placeholder="your X-API-KEY uuid"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Principal (email)</span>
          <input
            type="text"
            value={credentials.principal}
            onChange={(e) => setCredentials({ principal: e.target.value })}
            className="rounded bg-bg-base px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Snowprint ID</span>
          <input
            type="text"
            value={credentials.snowprintId}
            onChange={(e) => setCredentials({ snowprintId: e.target.value })}
            className="rounded bg-bg-base px-2 py-1 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">User ID</span>
          <input
            type="text"
            value={credentials.userId}
            onChange={(e) => setCredentials({ userId: e.target.value })}
            className="rounded bg-bg-base px-2 py-1 font-mono text-xs"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={loadFromApi}
          disabled={busy || !credentials.apiKey}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Loading…' : 'Load from API'}
        </button>
        <label className="cursor-pointer text-sm text-slate-300 underline decoration-dotted">
          or upload player.json
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && loadFromFile(e.target.files[0])}
          />
        </label>
        {player && (
          <span className="text-sm text-slate-400">
            {player.details.name} · {player.units.length} units
          </span>
        )}
      </div>

      {importError && (
        <pre className="mt-3 whitespace-pre-wrap rounded bg-accent-muted/20 p-2 text-xs text-red-300">
          {importError}
        </pre>
      )}
    </section>
  );
}
