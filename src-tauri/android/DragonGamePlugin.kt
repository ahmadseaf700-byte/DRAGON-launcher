package com.dragonlauncher.desktop

import android.app.Activity
import android.content.Intent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
internal class OpenGameArgs {
    lateinit var runtimeDir: String
    lateinit var versionId: String
    var ramMb: Int = 2048
}

@TauriPlugin
class DragonGamePlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun openGame(invoke: Invoke) {
        val args = invoke.parseArgs(OpenGameArgs::class.java)
        if (args.runtimeDir.isBlank() || args.versionId.isBlank()) {
            invoke.reject("A Java runtime directory and Minecraft version are required")
            return
        }

        activity.runOnUiThread {
            try {
                val intent = Intent(activity, DragonGameActivity::class.java).apply {
                    putExtra(DragonGameActivity.EXTRA_RUNTIME_DIR, args.runtimeDir)
                    putExtra(DragonGameActivity.EXTRA_VERSION_ID, args.versionId)
                    putExtra(DragonGameActivity.EXTRA_RAM_MB, args.ramMb.coerceIn(512, 8192))
                }
                activity.startActivity(intent)
                invoke.resolve(JSObject().put("opened", true))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Could not open the Android game surface")
            }
        }
    }
}
