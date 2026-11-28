# DRAGON Launcher Android engine integration

This work is intentionally split between implemented Android scaffolding and the remaining Minecraft engine integration.

## Implemented in this branch

- Tauri v2 Android plugin registration for `DragonGamePlugin`.
- Native `DragonGameActivity` with an EGL-backed GLES 2 surface.
- Touch buttons that enqueue key-down/key-up events in a thread-safe queue.
- NDK C++ diagnostic library that attempts to load the installed ARM64 `libjvm.so` and checks for `JNI_CreateJavaVM`.
- A build preparation script that injects the Kotlin/C++ sources and manifest declaration into Tauri's generated Android project.

## Not yet a Minecraft runtime

The surface currently clears to a diagnostic background. The touch queue is not yet connected to GLFW/LWJGL callbacks. The C++ code only loads and inspects the JVM shared library; it does not create a VM or invoke `JLI_Launch`. GL4ES is not bundled or initialized. Consequently, this branch must not report Minecraft Java as playable on Android.

## Remaining engine work

1. Integrate a compatible Pojav-style Android JVM launcher entry point and its runtime library search path.
2. Build and package the matching LWJGL/GLFW Android backend and connect the input queue to its callbacks.
3. Package and initialize a renderer backend (GL4ES or a compatible alternative) against the Activity's EGL context.
4. Launch a real Minecraft version with its resolved classpath, natives, assets, authentication/session data, and lifecycle handling.
5. Test on physical ARM64 Android hardware, including pause/resume, touch input, memory limits, and crash recovery.

PojavLauncher is a reference implementation, not a drop-in library. Its upstream licensing and notices must be preserved if code is ever incorporated.

## Latest implementation step: JVM smoke-test attempt

The diagnostic-only `JNI_CreateJavaVM` symbol probe has been replaced with an actual, asynchronous JVM startup attempt:

- Loads the Android JRE's `libjli.so` and available core runtime libraries from the extracted Java 21 directory.
- Loads `lib/server/libjvm.so`, resolves `JNI_CreateJavaVM`, and requests a HotSpot VM in the app process.
- Calls `java.lang.System.getProperty("java.version")` through the created VM and reports the returned version in the activity.
- Runs off the Android UI thread and reports linker/JVM startup errors rather than claiming success.

**Important:** this is an implementation attempt, not proof that the runtime starts on a real device. Android linker namespaces, the exact JRE artifact layout, and runtime-specific bootstrap requirements may still prevent VM startup. GitHub Actions can verify compilation and APK packaging, but cannot prove that HotSpot successfully starts on physical hardware.

The Android Activity still displays a diagnostic GLES surface. Minecraft is not playable yet: LWJGL/GLFW, a real renderer backend, game launch arguments/classpath, and live touch-to-GLFW input remain unintegrated.
