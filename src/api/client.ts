// Resolution order:
//   1. VITE_API_BASE — set this to your Cloudflare Worker URL to bypass CORS.
//   2. Dev server — Vite proxies /tacticus-api → api.tacticusgame.com.
//   3. Everything else — direct host call (will CORS-fail on GitHub Pages
//      without step 1; UI falls back to manual player.json upload).
export const DEFAULT_BASE = (() => {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  if (envBase) return envBase.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'https://api.tacticusgame.com';
  if (import.meta.env.DEV) return '/tacticus-api';
  return 'https://api.tacticusgame.com';
})();

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`API ${status}: ${body.slice(0, 400)}`);
    this.name = 'ApiError';
  }
}

export interface ApiCredentials {
  apiKey: string;
  snowprintId?: string;
  userId?: string;
  principal?: string;
  baseUrl?: string;
}

export async function apiGet<T>(path: string, creds: ApiCredentials): Promise<T> {
  const base = creds.baseUrl ?? DEFAULT_BASE;
  const headers: Record<string, string> = {
    'X-API-KEY': creds.apiKey,
    Accept: 'application/json',
  };
  if (creds.snowprintId) headers['SNOWPRINT-ID'] = creds.snowprintId;
  if (creds.userId) headers['USER-ID'] = creds.userId;
  if (creds.principal) headers['PRINCIPAL'] = creds.principal;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers });
  } catch (e) {
    throw new Error(
      `Network error calling ${base}${path}: ${(e as Error).message}. ` +
        `If this is a CORS block, either (a) run the app with \`npm run dev\` which proxies /tacticus-api, ` +
        `(b) deploy the Cloudflare Worker in cloudflare-worker/ and rebuild with VITE_API_BASE set to its URL, ` +
        `or (c) run \`npm run fetch:player\` and upload the resulting JSON instead.`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}
