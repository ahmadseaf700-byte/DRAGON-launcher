# DRAGON Launcher — Cross-platform runtime strategy

## Goal
Keep one shared launcher experience while selecting a native Minecraft runtime and rendering backend for each operating system and CPU architecture. The launcher must never infer that a Minecraft version is playable merely because its files are downloaded.

## Platform matrix

| Platform | Launcher target | CPU targets | Java runtime | Game rendering/input backend | Status |
|---|---|---|---|---|---|
| Windows | Tauri desktop | x64, ARM64 where dependencies permit | Bundled or discovered Windows JRE matching the process architecture | Native desktop OpenGL path; validate driver and GLFW/LWJGL compatibility | Desktop launch path exists but needs end-to-end validation |
| Linux | Tauri desktop | x64, ARM64 where dependencies permit | Bundled or discovered Linux JRE matching the process architecture | Native desktop OpenGL path; validate distro libraries and drivers | Desktop launch path exists but needs end-to-end validation |
| macOS | Tauri desktop | Apple Silicon, Intel | Bundled or discovered macOS JRE matching the process architecture | Native macOS graphics path; validate LWJGL and signing/notarization | Must be validated separately |
| Android | Tauri mobile | ARM64 first; other ABIs only when dependencies support them | Android-compatible Java runtime, not a desktop JRE copied into the APK | Dedicated Android renderer/window/input integration; desktop GLFW assumptions cannot be reused | Not supported for Minecraft Java launch yet |

A platform is considered supported only after its complete launch path passes the acceptance checks below. Building the Tauri shell for a platform is not equivalent to supporting Minecraft Java gameplay.

## Shared launcher responsibilities

1. Detect OS, process architecture, device memory, and available storage at runtime.
2. Resolve a Java runtime whose major version and architecture satisfy the selected Minecraft version and mod loader.
3. Download and verify Minecraft metadata, client, libraries, native classifiers, and assets.
4. Resolve platform-specific library rules and native artifacts without silently skipping required dependencies.
5. Build an argument list using the selected instance's isolated game directory.
6. Select a platform-specific process launcher and graphics/input backend.
7. Capture logs, exit status, and actionable errors.
8. Report separate states for downloaded, runtime_ready, launch_backend_ready, and playable.

## Platform-specific boundaries

- Keep version metadata parsing and download verification shared.
- Keep Java discovery/installation behind a platform runtime interface.
- Keep process creation behind a platform launcher interface.
- Keep graphics, window, and input integration behind a rendering backend interface.
- Android must not call desktop-only GLFW/LWJGL startup code. It needs an Android-aware backend and a compatible Java runtime.
- Native libraries must be selected by OS and ABI. Unknown or unsupported classifiers must produce a clear diagnostic rather than being treated as successfully installed.
- Do not label a version as playable solely because its JAR and assets exist.

## Delivery order

### Phase A — platform detection and capability reporting
- Normalize OS/architecture identifiers.
- Expose an explicit capability report to the UI.
- Distinguish launcher-shell support from Minecraft Java launch support.
- Add tests for OS/architecture mapping and unsupported combinations.

### Phase B — desktop runtime foundation
- Implement Java discovery and validation for Windows, Linux, and macOS.
- Validate required Java major versions per Minecraft version.
- Add desktop launch smoke tests on each supported OS/architecture.

### Phase C — Android runtime foundation
- Select and package an Android-compatible Java runtime per supported ABI.
- Validate runtime startup inside the Android app sandbox.
- Implement Android process lifecycle, rendering surface, graphics translation, and touch/keyboard input integration.
- Only then enable the Android Play action.

### Phase D — loaders and compatibility
- Add Forge, Fabric, and NeoForge metadata and launch argument support.
- Validate native libraries and mod-loader compatibility per platform.
- Add regression tests for isolated instances.

## Acceptance checklist

A platform may be marked Minecraft Java playable only when all of these pass on a real target device/OS:

- [ ] Correct Java runtime is found or installed and its version is verified.
- [ ] All required Minecraft libraries and native artifacts for the target OS/ABI are present.
- [ ] The game process starts with the selected instance directory.
- [ ] A game window/surface is created and renders the main menu.
- [ ] Keyboard, mouse, or touch input works as appropriate.
- [ ] Logs and process exit status are captured.
- [ ] A second instance can be launched without mixing saves, mods, or configuration.

Until then, the UI must display the platform as not yet supported for gameplay, even if downloads and instance management work.