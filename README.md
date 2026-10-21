# Fuel Shift System

Fuel station operations system running on Cloudflare Workers with Supabase PostgreSQL.

## Architecture

Browser → Cloudflare Worker → Supabase

## Implemented workflows

- Admin and employee login with hashed PINs
- One-time first-admin bootstrap
- Employee management and activation/deactivation
- Tank creation and inventory adjustment
- Nozzle creation and activation/deactivation
- Employee-to-nozzle shift assignment
- Shift start and closing
- Fuel sales with payment method
- Atomic sale + tank deduction + tank movement
- Fuel purchases with atomic tank increase + movement
- Shift handover submission and confirmation
- Daily sales/purchase reporting
- Daily report snapshots
- Tank movement history
- Low-inventory dashboard alerts

## Security

- Supabase secret key is server-side only.
- Browser calls the Worker API; it never receives the Supabase secret.
- PINs are stored as PBKDF2-SHA256 hashes using Cloudflare Web Crypto.
- Admin-only operations are enforced in the Worker.
- Session cookies are Secure, HttpOnly and SameSite=Lax.

## Deploy

Set the Cloudflare Worker secrets:

- SUPABASE_SECRET_KEY
- SESSION_SECRET
- BOOTSTRAP_TOKEN

Keep SUPABASE_URL in Wrangler variables.

Deploy:

    uv run pywrangler deploy

After the first administrator is created, rotate or remove the BOOTSTRAP_TOKEN secret.

## First station setup

1. Log in as admin.
2. Open Settings.
3. Create tanks with their real capacities and current inventory.
4. Create matching nozzles.
5. Create employee accounts.
6. Assign a nozzle to an employee.
7. Employee starts the shift using the actual opening meter/tank readings.
8. Record sales.
9. Use Handover for employee changes.
10. Use Purchases when fuel is delivered.
11. Use Daily Report for reconciliation.

## Important operating rule

Do not enter demonstration readings or prices into production data. Opening/closing readings and inventory values should be the actual station measurements.

## API

Health:
- GET /api/health

Authentication:
- POST /api/login
- POST /api/logout
- GET /api/me
- POST /api/bootstrap-admin

Administration:
- GET/POST /api/employees
- PATCH /api/employees/:id
- GET/POST /api/tanks
- PATCH /api/tanks/:id
- GET/POST /api/nozzles
- PATCH /api/nozzles/:id
- GET/POST /api/shifts

Operations:
- POST /api/shifts/:id/start
- POST /api/shifts/:id/close
- GET/POST /api/sales
- GET/POST /api/purchases
- GET /api/tank-movements
- GET/POST /api/handovers
- POST /api/handovers/:id/confirm
- GET/POST /api/reports/daily

## Attendant phone push notifications

The handover notification feature uses a Supabase Edge Function named `send-handover-push` and the `public.push_subscriptions` table. The function code is deployed, but phone push is not active until the following secrets are configured.

Set these **Cloudflare Worker secrets**:
- `VAPID_PUBLIC_KEY` — the URL-safe base64 public key from your VAPID key pair.
- `PUSH_DELIVERY_TOKEN` — a long random shared token used only between the Worker and the Edge Function.

Set these **Supabase Edge Function secrets** for `send-handover-push`:
- `PUSH_DELIVERY_TOKEN` — exactly the same token as in Cloudflare.
- `VAPID_PUBLIC_KEY` — the same VAPID public key.
- `VAPID_PRIVATE_KEY` — the private key matching the public key; never commit or expose it.
- `VAPID_SUBJECT` — a valid contact URI such as `mailto:operations@example.com`.

The Supabase Edge Function also requires the project-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment values. Never put the service-role key or VAPID private key in browser code or the repository.

After configuring secrets, redeploy the Worker so it receives the new secrets, then test subscription on an HTTPS Android browser and submit a handover to that attendant. Push delivery has not been end-to-end tested yet.


## AI Data Analyst

The admin-only **AI Data Analyst** page is available at `/admin-ai-analyst.html`. It provides read-only analysis of summarized sales, purchases, inventory, shift/handover status, logistics deliveries, and transport-payment records. AI responses should be checked against official DSR/MSR reports before making financial decisions.

This feature uses the Google Gemini Developer API. Create a key in [Google AI Studio](https://aistudio.google.com/) and configure it as a **Cloudflare Worker secret** named `GEMINI_API_KEY`. Never commit the key or put it in browser code.

Optional Worker variable:
- `GEMINI_MODEL` — defaults to `gemini-2.5-flash-lite`. Select a model available to your Google AI Studio project and its current quota.

After setting the secret, redeploy the Worker. The Gemini API free tier has model-specific rate limits and data-use terms; verify current limits and privacy terms in the [Gemini API pricing documentation](https://ai.google.dev/gemini-api/docs/pricing). Do not send sensitive data unless the provider's terms are suitable for your station.
