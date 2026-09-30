# Fuel Shift System â Cloudflare + Supabase v2

This version moves the application database from Google Sheets to Supabase PostgreSQL and runs the web app on Cloudflare Workers using Flask.

## Current API
- GET /api/health
- POST /api/login
- POST /api/logout
- GET /api/me
- POST /api/bootstrap-admin (one-time setup token required)
- GET /api/tanks
- GET /api/nozzles
- GET /api/shifts
- GET /api/sales

## Secrets
Never put SUPABASE_SECRET_KEY in frontend JavaScript. Store it as a Cloudflare Worker secret.

## Local development
Use the current Cloudflare Python Worker tooling:

    uv run pywrangler dev

## Deploy

    uv run pywrangler deploy

Before deployment, configure the secrets:

    npx wrangler secret put SUPABASE_URL
    npx wrangler secret put SUPABASE_SECRET_KEY
    npx wrangler secret put SESSION_SECRET
    npx wrangler secret put BOOTSTRAP_TOKEN

For the first admin, POST JSON to /api/bootstrap-admin with header X-Bootstrap-Token set to the bootstrap token. After creating the admin, remove/rotate the bootstrap token.

The included public/ folder is the phone demo UI from the earlier prototype. The next migration pass will connect each existing page to these APIs and add the remaining transactional endpoints.
