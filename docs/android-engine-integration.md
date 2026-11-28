# Android Minecraft engine integration decision

Status: research complete; no engine code is claimed as integrated by this document.

## Decision

DRAGON should keep its Tauri + React launcher UI and integrate an Android-only engine adapter behind the existing `android-game` Tauri plugin. Do not copy the complete Amethyst application into DRAGON: Amethyst is itself a full launcher application with its own Android app module, activities, settings, and lifecycle. Instead, evaluate and port only the engine-facing components needed by the adapter, or build a separately maintained engine module from the upstream components.

Primary upstream reference:
- Repository: https://github.com/AngelAuraMC/Amethyst-Android
- Branch reviewed: `v3_openjdk`
- Upstream README identifies Android support for OpenJDK 8/17/21, OpenGL, OpenAL, LWJGL, GLFW stub, and native input.
- Upstream build instructions explicitly include the `jre_lwjgl3glfw` module and its LWJGL 3.3.3 / 3.4.1 projects. A plain `libjvm.so` plus a GLES surface is not a substitute for these pieces.

## License and dependency gate

The reviewed Amethyst branch states that Amethyst is LGPLv3. Its README also lists dependencies with different licenses, including PojavLauncher (GLGPL), GL4ES (MIT), MobileGlues (LGPL-2.1), LWJGL3 (BSD-3-Clause), OpenJDK components (GPLv2), and other native components. It also lists LWJGLX with an unknown license.

Before importing or distributing any source or binary:
1. Pin every upstream dependency to an exact commit/tag.
2. Record the license for each source tree and binary; do not assume the top-level LGPLv3 covers every dependency.
3. Preserve copyright and license notices and provide corresponding source/offer information where the applicable license requires it.
4. Do not include a dependency with an unresolved license (currently the README labels LWJGLX as unknown) in a release build until its licensing is clarified.
5. Keep the Android engine integration isolated so Windows, Linux, and macOS continue using the existing desktop launch path.

## Required integration layers

1. **Runtime bootstrap:** use the upstream Android JRE layout and startup conventions. The current DRAGON JNI probe only opens `libjvm.so` and finds `JNI_CreateJavaVM`; it does not create a VM or call the launch entry point.
2. **LWJGL/GLFW:** build and package the Android-compatible LWJGL artifacts and GLFW stub for each supported Android ABI. Resolve native library search paths before attempting launch.
3. **Graphics:** use the renderer path supported by the selected upstream engine version. The current DRAGON `GLSurfaceView` only clears a GLES2 surface; it does not provide the OpenGL context expected by Minecraft.
4. **Input/audio:** connect Android touch, keyboard, pointer, and audio events to the engine's actual native callbacks. The current queue has no engine consumer.
5. **Minecraft launch:** pass a resolved version classpath, native paths, assets, game/JVM arguments, authentication/session data, and working directory to the real launch entry point.
6. **Lifecycle:** handle pause/resume, surface recreation, process death, exit status, logs, and memory limits without leaving a stale running state.

## Acceptance tests

Do not mark Android gameplay ready until all of these pass on a physical ARM64 device:
- Runtime self-test starts the intended Java 21 VM and reports its exact version.
- A minimal Java test program executes inside that VM.
- The engine creates and destroys its rendering surface across pause/resume.
- GLFW receives real key and pointer events from the Android input layer.
- A vanilla Minecraft version reaches the title screen and exits cleanly.
- A second launch works after a clean stop.
- The test build contains the required license notices and dependency inventory.

## Current DRAGON status

The Android artifact download/extraction and diagnostic activity are build-verified by GitHub Actions run 46131574506 (Android APK and Windows installers both succeeded). They are scaffolding only. The JVM is not started, Minecraft is not launched, and the renderer/input/audio stack is not connected.

## Next implementation unit

Create a dedicated Android engine module and port the minimum upstream runtime bootstrap + GLFW/LWJGL + renderer dependencies into it, preserving upstream attribution and licenses. Keep it behind the existing Tauri plugin interface. The first deliverable should be a VM smoke-test screen; only after that passes should the Minecraft launch pipeline be connected.
