---
name: Mobile secure storage fallback
description: Storage behavior for Expo apps that also render in the browser preview
---

Use SecureStore on iOS and Android, but provide an explicit browser fallback because SecureStore may reject calls on web even though it is available in the native Expo environment.

**Why:** The browser preview is useful for visual verification, and a native-only storage call can incorrectly surface a settings error before the user interacts with the app.

**How to apply:** Branch on `Platform.OS === 'web'` at the storage boundary; keep secrets out of source and persist native credentials in SecureStore.

The direct client-side Telegram Bot API upload flow has been confirmed working on a physical phone through Expo Go, so a backend is not required for this app's first version.

**Why:** The user tested the completed app and reported that it works very well.

**How to apply:** Preserve the direct phone-to-Telegram architecture unless a future requirement needs server-side processing, shared credentials, or background delivery.