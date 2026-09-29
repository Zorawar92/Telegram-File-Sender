---
name: Expo incoming sharing platforms
description: Expo Sharing’s incoming-payload hook is native-only and must not mount in browser previews.
---

Expo Sharing’s incoming-payload APIs intentionally throw on web. Keep the receiving hook behind an Android/native-only component; browser preview support should remain available for manual file picking.

**Why:** The package exposes share-out support on web but not incoming share-payload resolution, so mounting the hook unconditionally crashes the preview.

**How to apply:** When adding incoming share handling, isolate `useIncomingShare()` in a component rendered only on supported native platforms.