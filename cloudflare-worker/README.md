# Tacticus API CORS proxy (Cloudflare Worker)

GitHub Pages can't call `https://api.tacticusgame.com` directly because the
API doesn't send `Access-Control-Allow-Origin` for the Pages origin. This
worker relays the request and adds the header.

**Cost:** free. Cloudflare Workers' free tier is 100,000 requests/day. One
player load is one request, so this sits well within the limit.

**Privacy:** the worker is a pass-through — it forwards the `X-API-KEY` header
as-is and never logs or stores it. Deploy it to your own Cloudflare account
so nobody else sees the traffic.

## One-time setup

1. Sign up for a free Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. From this directory:

   ```bash
   cd cloudflare-worker
   npm install
   npx wrangler login     # opens browser, logs into your CF account
   ```

3. Edit `wrangler.toml` → `ALLOWED_ORIGINS` to your Pages URL (and
   `http://localhost:5173` if you want to reuse the worker in dev).

4. Deploy:

   ```bash
   npm run deploy
   ```

   Wrangler prints a URL like `https://tacticus-api-proxy.<your-name>.workers.dev`.

## Point the app at the worker

Rebuild the app with `VITE_API_BASE` pointing at the worker URL:

```bash
cd ..
VITE_API_BASE=https://tacticus-api-proxy.<your-name>.workers.dev npm run build
```

Or, for the GitHub Pages deploy, add a repo variable (not a secret) named
`VITE_API_BASE` in **Settings → Secrets and variables → Actions → Variables**.
The deploy workflow passes it through to the build.

## Verify

```bash
curl -i -H "Origin: https://fillslava.github.io" \
     -H "X-API-KEY: $VITE_TACTICUS_API_KEY" \
     https://tacticus-api-proxy.<your-name>.workers.dev/api/v1/player
```

Expect `HTTP/2 200` with `access-control-allow-origin: https://fillslava.github.io`.

## Tail logs

```bash
npm run tail
```

## Free-tier watch

The Cloudflare dashboard shows your daily request count under
**Workers & Pages → tacticus-api-proxy → Metrics**. One user loading their
roster is one request. At 100k/day the free tier is very generous for a
hobby tool; you'd need ~3,000 loads per day from a single user to hit it.
