export const DEFAULT_BASE =
  typeof window !== 'undefined' ? '/tacticus-api' : 'https://api.tacticusgame.com';

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
        `If this is a CORS block, make sure you started the app with \`npm run dev\` (which proxies /tacticus-api), not by opening index.html.`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}
