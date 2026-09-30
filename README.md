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
