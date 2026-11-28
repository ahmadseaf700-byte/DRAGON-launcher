#include <jni.h>
#include <dlfcn.h>
#include <android/log.h>
#include <cstdlib>
#include <mutex>
#include <string>
#include <vector>

namespace {
constexpr const char* TAG = "DragonJvmBridge";
using CreateJavaVm = jint (*)(JavaVM**, void**, void*);
void* g_jvm_handle = nullptr;
JavaVM* g_java_vm = nullptr;
std::mutex g_vm_mutex;

std::string join(const std::string& root, const std::string& suffix) {
    return root + "/" + suffix;
}

bool loadLibrary(const std::string& path, std::string& error) {
    dlerror();
    void* handle = dlopen(path.c_str(), RTLD_NOW | RTLD_GLOBAL);
    if (handle == nullptr) {
        const char* detail = dlerror();
        error = path + ": " + (detail == nullptr ? "unknown linker error" : detail);
        return false;
    }
    return true;
}

jstring result(JNIEnv* env, const std::string& message) {
    __android_log_print(ANDROID_LOG_INFO, TAG, "%s", message.c_str());
    return env->NewStringUTF(message.c_str());
}
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_dragonlauncher_desktop_DragonGameActivity_startJvmSmokeTest(
    JNIEnv* env, jobject /* instance */, jstring runtime_dir) {
    const char* raw = env->GetStringUTFChars(runtime_dir, nullptr);
    if (raw == nullptr) return result(env, "JVM test failed: could not read runtime path");
    const std::string home(raw);
    env->ReleaseStringUTFChars(runtime_dir, raw);

    std::lock_guard<std::mutex> lock(g_vm_mutex);
    if (g_java_vm != nullptr) {
        return result(env, "Java VM is already running in this app process");
    }

    const std::string server_dir = join(home, "lib/server");
    const std::string jli_dir = join(home, "lib/jli");
    const std::string lib_dir = join(home, "lib");
    const std::string old_path = std::getenv("LD_LIBRARY_PATH") == nullptr
        ? "" : std::getenv("LD_LIBRARY_PATH");
    const std::string library_path = server_dir + ":" + jli_dir + ":" + lib_dir +
        (old_path.empty() ? "" : ":" + old_path);
    setenv("JAVA_HOME", home.c_str(), 1);
    setenv("LD_LIBRARY_PATH", library_path.c_str(), 1);

    // Match the Android OpenJDK loader order used by Pojav-derived launchers.
    // Optional libraries are loaded only when present in this runtime package.
    const std::vector<std::string> support_libraries = {
        join(jli_dir, "libjli.so"),
        join(lib_dir, "libverify.so"),
        join(lib_dir, "libjava.so"),
        join(lib_dir, "libnet.so"),
        join(lib_dir, "libnio.so"),
        join(lib_dir, "libzip.so"),
        join(lib_dir, "libjimage.so")
    };
    for (const auto& path : support_libraries) {
        if (access(path.c_str(), F_OK) == 0) {
            std::string error;
            if (!loadLibrary(path, error)) return result(env, "JVM dependency load failed: " + error);
        }
    }

    const std::string jvm_path = join(server_dir, "libjvm.so");
    std::string load_error;
    if (!loadLibrary(jvm_path, load_error)) {
        return result(env, "JVM load failed: " + load_error);
    }
    g_jvm_handle = dlopen(jvm_path.c_str(), RTLD_NOW | RTLD_GLOBAL);
    if (g_jvm_handle == nullptr) {
        const char* detail = dlerror();
        return result(env, std::string("JVM handle unavailable: ") +
            (detail == nullptr ? "unknown linker error" : detail));
    }

    dlerror();
    auto create_vm = reinterpret_cast<CreateJavaVm>(dlsym(g_jvm_handle, "JNI_CreateJavaVM"));
    const char* symbol_error = dlerror();
    if (create_vm == nullptr || symbol_error != nullptr) {
        return result(env, "JVM library loaded but JNI_CreateJavaVM is unavailable");
    }

    std::string java_home_option = "-Djava.home=" + home;
    std::string class_path_option = "-Djava.class.path=" + join(home, "lib/*");
    JavaVMOption options[2]{};
    options[0].optionString = java_home_option.data();
    options[1].optionString = class_path_option.data();

    JavaVMInitArgs args{};
    args.version = JNI_VERSION_1_8;
    args.nOptions = 2;
    args.options = options;
    args.ignoreUnrecognized = JNI_TRUE;

    JNIEnv* vm_env = nullptr;
    const jint status = create_vm(&g_java_vm, reinterpret_cast<void**>(&vm_env), &args);
    if (status != JNI_OK || g_java_vm == nullptr || vm_env == nullptr) {
        g_java_vm = nullptr;
        return result(env, "JNI_CreateJavaVM failed with status " + std::to_string(status));
    }

    jclass system_class = vm_env->FindClass("java/lang/System");
    if (system_class == nullptr) {
        vm_env->ExceptionClear();
        return result(env, "Java VM started, but java.lang.System could not be loaded");
    }
    jmethodID get_property = vm_env->GetStaticMethodID(
        system_class, "getProperty", "(Ljava/lang/String;)Ljava/lang/String;");
    if (get_property == nullptr) {
        vm_env->ExceptionClear();
        return result(env, "Java VM started, but System.getProperty was unavailable");
    }
    jstring key = vm_env->NewStringUTF("java.version");
    auto value = static_cast<jstring>(vm_env->CallStaticObjectMethod(system_class, get_property, key));
    if (vm_env->ExceptionCheck()) {
        vm_env->ExceptionClear();
        return result(env, "Java VM started, but reading java.version failed");
    }
    const char* version = value == nullptr ? nullptr : vm_env->GetStringUTFChars(value, nullptr);
    const std::string version_text = version == nullptr ? "unknown" : version;
    if (version != nullptr) vm_env->ReleaseStringUTFChars(value, version);
    return result(env, "Java VM started successfully; java.version=" + version_text);
}
