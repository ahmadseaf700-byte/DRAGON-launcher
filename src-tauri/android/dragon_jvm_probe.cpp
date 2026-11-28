#include <jni.h>
#include <dlfcn.h>
#include <string>
#include <android/log.h>

namespace {
constexpr const char* TAG = "DragonJvmBridge";
void* g_jvm_handle = nullptr;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_dragonlauncher_desktop_DragonGameActivity_probeJvm(
    JNIEnv* env, jobject /* instance */, jstring runtime_dir) {
    const char* raw = env->GetStringUTFChars(runtime_dir, nullptr);
    if (raw == nullptr) {
        return env->NewStringUTF("Could not read Java runtime path");
    }

    const std::string library_path = std::string(raw) + "/lib/server/libjvm.so";
    env->ReleaseStringUTFChars(runtime_dir, raw);

    if (g_jvm_handle == nullptr) {
        dlerror();
        g_jvm_handle = dlopen(library_path.c_str(), RTLD_NOW | RTLD_GLOBAL);
    }
    if (g_jvm_handle == nullptr) {
        const char* error = dlerror();
        const std::string message = std::string("JVM shared library load failed: ") +
            (error == nullptr ? "unknown linker error" : error);
        __android_log_print(ANDROID_LOG_ERROR, TAG, "%s", message.c_str());
        return env->NewStringUTF(message.c_str());
    }

    dlerror();
    void* create_vm = dlsym(g_jvm_handle, "JNI_CreateJavaVM");
    const char* symbol_error = dlerror();
    if (create_vm == nullptr || symbol_error != nullptr) {
        const std::string message = "libjvm.so loaded, but JNI_CreateJavaVM was not exported";
        __android_log_print(ANDROID_LOG_ERROR, TAG, "%s", message.c_str());
        return env->NewStringUTF(message.c_str());
    }

    // Loading and finding the JNI entry point is only a diagnostic probe.
    // Starting the VM still requires Pojav-compatible JLI, native library,
    // classpath, graphics, and lifecycle integration.
    return env->NewStringUTF("libjvm.so loaded; JNI_CreateJavaVM found (VM not started)");
}
