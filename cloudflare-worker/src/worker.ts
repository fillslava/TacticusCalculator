/**
 * Tacticus API CORS proxy — runs on Cloudflare Workers (free tier).
 *
 * - Forwards GET /api/v1/* to https://api.tacticusgame.com with the caller's
 *   X-API-KEY (and optional SNOWPRINT-ID / USER-ID / PRINCIPAL) header.
 * - Adds Access-Control-Allow-Origin for origins in ALLOWED_ORIGINS (set via
 *   `[vars] ALLOWED_ORIGINS = "https://a.example,https://b.example"` in
 *   wrangler.toml, comma-separated).
 * - Refuses every other method and every path that does not begin with /api/.
 *
 * The worker never logs or stores the API key; it is a pure pass-through.
 */

const UPSTREAM = 'https://api.tacticusgame.com';

const FORWARDED_REQUEST_HEADERS = [
  'X-API-KEY',
  'SNOWPRINT-ID',
  'USER-ID',
  'PRINCIPAL',
  'Accept',
  'Content-Type',
];

interface Env {
  ALLOWED_ORIGINS: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allowOrigin = allowed.includes(origin) ? origin : '';

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': FORWARDED_REQUEST_HEADERS.join(', '),
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!allowOrigin) return new Response('Forbidden origin', { status: 403 });
    if (request.method !== 'GET')
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/'))
      return new Response('Not found', { status: 404, headers: corsHeaders });

    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    const fwdHeaders: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const v = request.headers.get(name);
      if (v) fwdHeaders[name] = v;
    }

    const upstreamRes = await fetch(upstreamUrl, { method: 'GET', headers: fwdHeaders });
    const body = await upstreamRes.arrayBuffer();
    return new Response(body, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('Content-Type') ?? 'application/json',
        ...corsHeaders,
      },
    });
  },
};
