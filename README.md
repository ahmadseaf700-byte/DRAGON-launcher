# DRAGON Launcher

DRAGON is an independent Minecraft launcher project built with Tauri v2, Rust, React, TypeScript and Tailwind CSS.

## Current milestone

Phase 1 establishes the application shell, Arabic/English interface, native system diagnostics and GitHub Actions workflows for Windows installers and an Android APK.

The Play button is intentionally not connected to a game runtime yet. Microsoft authentication, local profiles, Minecraft downloads, mod loaders and game execution are subsequent milestones; this build does not claim those features are implemented.

## Development

Requirements: Node.js 20+, Rust stable, and the platform prerequisites for Tauri v2.

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run tauri -- build
```

Android builds are initialized and built by the GitHub Actions workflow. The Android application shell does not yet include a Java runtime or Minecraft execution environment.

## CI artifacts

Push to `main` or run the workflow manually from the GitHub Actions tab. Windows installers and the Android APK are uploaded as workflow artifacts when their respective jobs succeed.
