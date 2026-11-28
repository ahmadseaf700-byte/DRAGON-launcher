# Android Minecraft engine integration decision

Status: upstream architecture inspected; no engine code is claimed as integrated by this document.

## Decision

DRAGON should keep its Tauri + React launcher UI and integrate an Android-only engine adapter behind the existing `android-game` Tauri plugin. Do not copy the complete Amethyst application into DRAGON: Amethyst is itself a full launcher application with its own Android app module, activities, settings, storage model, and lifecycle. Port only the engine-facing components required by the adapter, or build a separately maintained engine module from pinned upstream components.

Primary upstream reference:
- Repository: https://github.com/AngelAuraMC/Amethyst-Android
- Branch reviewed: `v3_openjdk`
- Relevant upstream file: `app_pojavlauncher/src/main/java/net/kdt/pojavlaunch/utils/JREUtils.java`
- Relevant build module: `:jre_lwjgl3glfw`
- Upstream README describes Android support for OpenJDK 8/17/21, OpenGL, OpenAL, LWJGL, GLFW stub, and native input.
- Upstream build instructions explicitly build the GLFW stub and then the Android launcher. A plain `libjvm.so` plus a GLES surface is not a substitute.

## Findings from the upstream runtime bootstrap

The inspected `JREUtils.initJavaRuntime()` does substantially more than the current DRAGON probe:
- Loads `libjli.so` before the JVM and then loads `libjvm.so`.
- Loads supporting JRE libraries such as `libverify.so`, `libjava.so`, `libnet.so`, `libnio.so`, AWT/font libraries, and other runtime shared objects.
- Builds an Android-specific `LD_LIBRARY_PATH` including the JRE architecture directory, JLI directory, system/vendor libraries, native library directory, and LWJGL native directory.
- Configures `JAVA_HOME`, game home, cache/temp paths, renderer environment variables, and native library paths before launching.

This exposes a concrete gap in DRAGON: checking that `lib/server/libjvm.so` exists and resolving `JNI_CreateJavaVM` is not equivalent to initializing the upstream mobile runtime. The current native probe does not initialize the runtime, load the full dependency set, configure the environment, or invoke the Java launcher entry point.

The upstream Android Gradle build also uses more than a CMake JNI probe: it builds native code through `Android.mk`/ndk-build, packages multiple native AARs, and builds the `jre_lwjgl3glfw` project. The exact module/dependency graph must be ported deliberately rather than approximated by adding a single Maven dependency.

## License and dependency gate

The reviewed Amethyst branch states that Amethyst is LGPLv3. Its README also lists dependencies with different licenses, including PojavLauncher (GLGPL), GL4ES (MIT), MobileGlues (LGPL-2.1), LWJGL3 (BSD-3-Clause), OpenJDK components (GPLv2), SDL (zlib), OpenAL-Soft (GPLv2), and other native components. It also lists LWJGLX with an unknown license.

Before importing or distributing any source or binary:
1. Pin every upstream repository and binary to an exact commit/tag and record its checksum.
2. Record the license for each source tree and binary; do not assume the top-level LGPLv3 covers every dependency.
3. Preserve copyright and license notices and provide corresponding source/offer information where the applicable license requires it.
4. Do not include a dependency with an unresolved license (currently the README labels LWJGLX as unknown) in a release build until its licensing is clarified.
5. Keep Android engine integration isolated so Windows, Linux, and macOS continue using the existing desktop launch path.

## Required integration layers

1. **Runtime bootstrap:** port the verified upstream Android JRE initialization sequence, library loading order, architecture-specific paths, environment setup, and JLI startup. Do not mark Java ready merely because files were extracted.
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

Build a dedicated Android engine module around the pinned upstream runtime bootstrap and `:jre_lwjgl3glfw` build, including the exact native dependencies and license inventory. Keep it behind the existing Tauri plugin interface. The first deliverable is a VM smoke-test screen; only after it passes should the Minecraft launch pipeline be connected.
