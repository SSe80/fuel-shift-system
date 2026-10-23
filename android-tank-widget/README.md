# Fuel Shift System — Native Tank Inventory Widget

A separate native Android companion app is required because an installed PWA cannot register a real Android home-screen widget.

## Widget behavior
- Displays every active tank returned by the authenticated GET /api/tanks endpoint.
- Shows product/tank code, current litres, capacity, percentage full, level bar, and remaining capacity.
- Uses the existing Worker API and admin login endpoint; it does not connect directly to Supabase or include server secrets.
- Stores the admin session cookie in AndroidX encrypted shared preferences.
- Refreshes on demand and uses WorkManager for background refreshes. Android may defer background work to preserve battery.
- Tapping the widget opens its connection screen; sign in again if the session is invalid.

## Build
Open this android-tank-widget folder in Android Studio with JDK 17 and Android SDK 35 installed. Allow Gradle sync, then build the APK.

The Worker URL defaults to https://fuel-shift-system.servicestation50.workers.dev; the connection screen allows changing it if needed.

## Install on the phone
1. Install the generated APK on the Android phone.
2. Open Fuel Shift Tank Widget and connect using an admin Operator ID and PIN.
3. Long-press the Android home screen, choose Widgets, find Fuel Shift Tank Widget, and place the Tank Inventory widget.
4. Resize it vertically to show all tanks. Use the refresh icon for an immediate refresh.

## Security and limitations
- The widget uses the admin-only login endpoint and read-only tank list API.
- The PIN is sent only over HTTPS and is not saved. The returned admin session cookie is encrypted at rest.
- Background refresh frequency is controlled by Android; the refresh button triggers an immediate fetch.
- The widget requires the existing Worker API to remain reachable and the admin account to remain active.
