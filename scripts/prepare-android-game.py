#!/usr/bin/env python3
"""Install DRAGON's native Android game-surface sources into Tauri's generated project."""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "src-tauri" / "gen" / "android" / "app" / "src" / "main"
PACKAGE_DIR = GENERATED / "java" / "com" / "dragonlauncher" / "desktop"
SOURCE_DIR = ROOT / "src-tauri" / "android"

if not GENERATED.is_dir():
    raise SystemExit("Tauri Android project was not generated before prepare-android-game.py")

PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
for name in ("DragonGamePlugin.kt", "DragonGameActivity.kt", "DragonInputQueue.kt"):
    shutil.copy2(SOURCE_DIR / name, PACKAGE_DIR / name)

cpp_dir = GENERATED / "cpp"
cpp_dir.mkdir(parents=True, exist_ok=True)
for name in ("CMakeLists.txt", "dragon_jvm_probe.cpp"):
    shutil.copy2(SOURCE_DIR / name, cpp_dir / name)

manifest = GENERATED / "AndroidManifest.xml"
if not manifest.is_file():
    raise SystemExit("Generated AndroidManifest.xml was not found")
manifest_text = manifest.read_text(encoding="utf-8")
if ".DragonGameActivity" not in manifest_text:
    declaration = '''
        <activity
            android:name=".DragonGameActivity"
            android:exported="false"
            android:screenOrientation="landscape"
            android:configChanges="orientation|screenSize|keyboardHidden" />
'''
    if "</application>" not in manifest_text:
        raise SystemExit("Could not locate </application> in generated manifest")
    manifest_text = manifest_text.replace("</application>", declaration + "    </application>")
manifest.write_text(manifest_text, encoding="utf-8")

gradle = GENERATED.parent / "build.gradle.kts"
if not gradle.is_file():
    raise SystemExit("Expected generated app/build.gradle.kts; refusing an unverified Gradle edit")
text = gradle.read_text(encoding="utf-8")

def block_end(source: str, opening_brace: int) -> int:
    depth = 0
    for index in range(opening_brace, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return index
    raise ValueError("Unbalanced Gradle block")

def locate_block(source: str, name: str):
    match = re.search(r"(?m)^\s*" + re.escape(name) + r"\s*\{", source)
    if not match:
        return None
    opening = source.find("{", match.start())
    return opening, block_end(source, opening)

if 'path = file("src/main/cpp/CMakeLists.txt")' not in text:
    android_block = locate_block(text, "android")
    if android_block is None:
        raise SystemExit("Could not locate android { } block in generated Gradle file")
    android_open, android_end = android_block
    android_body = text[android_open + 1:android_end]

    default_block = locate_block(android_body, "defaultConfig")
    if default_block is None:
        raise SystemExit("Could not locate defaultConfig { } block in generated Gradle file")
    default_open, _ = default_block
    default_end = android_open + 1 + block_end(android_body, default_open)
    default_config = '''
        externalNativeBuild {
            cmake {
                cppFlags += "-std=c++17"
            }
        }
'''
    text = text[:default_end] + default_config + text[default_end:]

    android_open, android_end = locate_block(text, "android")
    native_config = '''
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }
'''
    text = text[:android_end] + native_config + text[android_end:]

gradle.write_text(text, encoding="utf-8")
print("Installed DRAGON Android activity, touch-input queue, JNI JVM probe, manifest entry, and CMake build config.")
