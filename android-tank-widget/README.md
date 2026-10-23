# Fuel Shift System Admin — Native Android app + Tank Widget

This Android app packages the hosted Fuel Shift System Admin interface and the native Android Tank Inventory home-screen widget in one APK.

## Included
- Native launcher opens the hosted Admin dashboard in a WebView.
- JavaScript, DOM storage, session cookies, downloads, and HTML file selection are enabled for web workflows.
- A native toolbar opens Admin, configures the Tank Widget, or reloads the page.
- The home-screen widget shows active tanks, product/tank label, current stock in liters, capacity, percent full, remaining capacity, and manual refresh.
- Widget session cookie is stored in Android encrypted preferences; the PIN is not saved.
- Periodic refresh is requested every 30 minutes; Android can defer background work.
- Widget taps open the Admin app rather than a separate browser or separate widget app.

## Build
Open this folder in Android Studio with JDK 17 and Android SDK 35, allow Gradle sync, then build the app's assembleDebug task. GitHub Actions builds the APK and publishes it as a workflow artifact.

## Install and first setup
1. Install the generated Fuel Shift System Admin APK.
2. Open it and sign in to the hosted Admin interface.
3. Tap Tank Widget in the native top bar and connect with the admin Operator ID and PIN. The PIN is not retained; the returned session cookie is encrypted at rest.
4. Long-press the Android home screen, open Widgets, choose Fuel Shift System Admin, and add Tank Inventory.
5. Use the widget refresh icon for an immediate update. Background updates are controlled by Android.

## Important notes
- The website-installed PWA is a different Android app type and cannot be upgraded in place into a native APK. Install this APK to use the unified native app; the old PWA shortcut can be removed only after verifying the new app.
- The native shell loads the existing Worker-hosted Admin dashboard. Keep the Worker and Admin routes available.
- This is a first native wrapper iteration. Before replacing the PWA shortcut, test login, reports, uploads/downloads, Google Drive OAuth, and phone push notifications. WebView-based apps do not automatically inherit every Chrome PWA capability; push and OAuth behavior may need additional native integration.
- The app does not contain Supabase service-role keys or any server secrets.
