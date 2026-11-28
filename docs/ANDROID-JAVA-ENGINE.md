# DRAGON Android Java Edition Engine

Status: **architecture decision / integration not yet implemented**

## Upstream choice

Use [AngelAuraMC/Amethyst-Android](https://github.com/AngelAuraMC/Amethyst-Android) as the primary technical reference and evaluate its native runtime components. The old PojavLauncherTeam organization/repository is archived; Amethyst is the successor. The upstream README documents an Android mobile JRE, custom LWJGL/GLFW, native rendering/audio components, and an Android launcher build.

Upstream snapshot reviewed for this decision:
- Repository: https://github.com/AngelAuraMC/Amethyst-Android
- Branch: `v3_openjdk`
- Commit reviewed: `9423d6054115767b56de7ed0b83ed18fc1eba3c2`
- Project license reported by GitHub: LGPL-3.0
- This is not blanket permission to copy every dependency. Audit each component's license and notices.

## Integration decision

Do **not** copy `.so` files or JRE contents out of a released APK. Do **not** add an unpinned "download latest" action to CI. Native artifacts must be traceable to source commits/builds, match Android ABI + NDK/API requirements, and be verified by SHA-256 before packaging.

The target architecture is a DRAGON-owned Android host with a separately isolated engine adapter. Keep the existing Tauri/React launcher UI and desktop Rust launcher path separate.

### Required Android components

1. Android-compatible OpenJDK/JVM runtime for ARM64. It must be bootstrapped using the engine's supported native invocation path; an extracted `bin/java` alone is not a supported Android launch mechanism.
2. Engine bootstrap that creates the JVM with correct Android linker paths, environment, working directory, classpath, and native library path.
3. Matching LWJGL and GLFW compatibility classes/native libraries for the exact game/runtime combination.
4. Renderer backend selected from supported upstream builds (GL4ES/Mesa/ANGLE/VirGL as appropriate). Do not assume all renderers work on every GPU.
5. Android game surface lifecycle, orientation/resize handling, touch/mouse/keyboard/gamepad input, audio, clipboard, and process/log lifecycle.
6. Minecraft version metadata adaptation: platform-specific natives, library rules, assets, JVM arguments, and classpath.
7. Real-device validation on ARM64, including launch, menu rendering, world load, input, audio, pause/resume, and clean exit.

## DRAGON adapter contract

The UI should only call a narrow native API:
- `android_engine_capabilities()` — report verified runtime/renderer/input support and engine version.
- `android_engine_install_runtime(java_major, abi)` — install only a pinned, checksummed runtime bundle.
- `android_engine_launch(session_config)` — launch a prepared Minecraft session and return a session identifier.
- `android_engine_stop(session_id)` — request graceful stop, then force-stop only if necessary.
- Events: `engine-log`, `engine-progress`, `engine-state`, and `engine-surface-ready`.

The Android engine owns its game surface and native lifecycle. The web UI must not attempt to spawn a desktop `java` process on Android.

## Build and test gates

- CI must build the Android ARM64 target and run Kotlin/Java/Rust compile checks.
- Package inspection must confirm all expected native libraries are ARM64 and have no unresolved shared-library dependencies.
- Verify checksums for every downloaded runtime/native artifact.
- A test device must pass launch-to-title-screen and world-entry smoke tests before Android Play can be enabled.
- Until every gate passes, Play stays disabled on Android with an explicit explanation.

## Why we are not embedding the Amethyst APK

An APK is an installable application, not a reusable engine library. Embedding it or copying arbitrary files from it does not provide a stable API, correct Android activity/surface integration, or a reliable licensing trail. A real integration needs source-level module boundaries and a maintained adapter; otherwise DRAGON would only hand off to another launcher instead of launching the game itself.
