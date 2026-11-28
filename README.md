# DRAGON Launcher

DRAGON is an independent Minecraft launcher project built with Tauri v2, Rust, React, TypeScript and Tailwind CSS.

## Current milestone

The project currently provides the launcher shell, Arabic/English interface, system diagnostics, version/library UI, and CI workflows for Windows installers and an Android APK.

**Important:** The Android APK is currently a launcher shell. It does not yet contain an Android-compatible Minecraft Java execution engine. A successful APK build must not be interpreted as proof that Minecraft can launch.

## Android Java Edition engine status

Android cannot use the desktop Java installation flow or the ordinary desktop LWJGL/GLFW binaries. A real Android game runtime requires a coordinated native integration:

- An Android-compatible OpenJDK/JVM build for the target ABI, installed in the app-private data directory.
- A JVM bootstrap/launcher bridge that initializes the VM with Android's linker and runtime constraints. Merely placing a `bin/java` file in app storage is not enough.
- Android-compatible LWJGL/GLFW integration and the matching native libraries for the selected ABI.
- A renderer backend (for example, a supported GL4ES/Mesa path) configured for the device's graphics driver.
- An Android game surface, lifecycle handling, keyboard/gamepad/touch input routing, audio, and process/log management.
- Per-Minecraft-version native/library selection and compatibility tests.

The existing desktop `launch_minecraft` path deliberately rejects Android. The React Play action now also fails fast on Android with an explicit capability message, instead of requesting a local profile and then attempting the desktop Java/process path.

### Engine integration policy

Do not copy arbitrary `.so` files or a JRE archive from another launcher's APK. Native components must be built or obtained from a traceable upstream release, match the Android ABI and NDK/API requirements, pass integrity checks, and retain their required notices and source-offer obligations.

PojavLauncher documents a complete Android build that includes prebuilt mobile JRE artifacts, custom LWJGL/GLFW pieces, and native components; this is an engine integration project, not a simple Java download. Its published project license is LGPL-3.0. Any reuse or linking must be reviewed for LGPL compliance and all component licenses. A separate Android launcher project may use GPL-3.0, which has different redistribution/source obligations; do not copy its code into this project without an explicit licensing decision.

The intended integration boundary is a native Android engine adapter behind a small DRAGON interface. The React/Tauri UI should request capabilities and launch sessions through that adapter; desktop launch code must remain separate. Until the Android adapter, runtime, renderer and input path are implemented and tested on real ARM64 devices, Android Play must remain unavailable.

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

Android builds are initialized and built by the GitHub Actions workflow. The current Android workflow targets ARM64 and builds the Tauri application shell; it does not yet package a Minecraft JVM/renderer engine.

## CI artifacts

Push to `main` or run the workflow manually from the GitHub Actions tab. Windows installers and the Android APK are uploaded as workflow artifacts when their respective jobs succeed.
