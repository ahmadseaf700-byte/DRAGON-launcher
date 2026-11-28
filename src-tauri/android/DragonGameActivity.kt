package com.dragonlauncher.desktop

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.opengl.GLSurfaceView
import android.opengl.GLES20
import java.io.File
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

class DragonGameActivity : Activity() {
    companion object {
        const val EXTRA_RUNTIME_DIR = "dragon.runtimeDir"
        const val EXTRA_VERSION_ID = "dragon.versionId"
        const val EXTRA_RAM_MB = "dragon.ramMb"
    }

    private var surface: GLSurfaceView? = null
    private lateinit var status: TextView

    private external fun probeJvm(runtimeDir: String): String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        val runtimeDir = intent.getStringExtra(EXTRA_RUNTIME_DIR).orEmpty()
        val versionId = intent.getStringExtra(EXTRA_VERSION_ID).orEmpty()
        val ramMb = intent.getIntExtra(EXTRA_RAM_MB, 2048)
        val root = File(runtimeDir)
        val jvmLibrary = File(root, "lib/server/libjvm.so")

        val frame = FrameLayout(this).apply { setBackgroundColor(Color.rgb(10, 14, 22)) }
        val gl = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            setRenderer(DragonSurfaceRenderer())
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
        surface = gl
        frame.addView(gl, FrameLayout.LayoutParams(-1, -1))

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 18, 24, 18)
            setBackgroundColor(0xCC101827.toInt())
        }
        status = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 15f
            text = "DRAGON Android game surface\nChecking Java runtime…"
        }
        panel.addView(status)
        val panelParams = FrameLayout.LayoutParams(-1, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP)
        frame.addView(panel, panelParams)

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(12, 12, 12, 18)
        }
        listOf("W", "A", "S", "D", "JUMP", "ATTACK").forEach { label ->
            val key = when (label) {
                "W" ->  forwardKey
                "A" -> leftKey
                "S" -> backKey
                "D" -> rightKey
                "JUMP" -> jumpKey
                else -> attackKey
            }
            val button = Button(this).apply {
                text = label
                isAllCaps = false
                setOnTouchListener { _, event ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> DragonInputQueue.push("key_down", key, 0f, 0f)
                        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> DragonInputQueue.push("key_up", key, 0f, 0f)
                    }
                    true
                }
            }
            controls.addView(button, LinearLayout.LayoutParams(0, 64, 1f).apply {
                marginStart = 4
                marginEnd = 4
            })
        }
        frame.addView(controls, FrameLayout.LayoutParams(-1, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        setContentView(frame)

        val nativeStatus = runCatching {
            System.loadLibrary("dragon_jvm_bridge")
            probeJvm(runtimeDir)
        }.getOrElse { "Native JVM probe unavailable: ${it.message}" }
        val packageStatus = if (jvmLibrary.isFile) "libjvm.so found" else "libjvm.so missing"
        status.text = "DRAGON Android engine bootstrap\nMinecraft: $versionId · RAM: $ramMb MB\n$packageStatus\n$nativeStatus\n\nThe game engine is not linked yet; this screen verifies the Android surface and input layer only."
    }

    override fun onPause() {
        surface?.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        surface?.onResume()
    }

    override fun onDestroy() {
        surface = null
        super.onDestroy()
    }

    private class DragonSurfaceRenderer : GLSurfaceView.Renderer {
        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            GLES20.glClearColor(0.035f, 0.055f, 0.09f, 1f)
        }
        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            GLES20.glViewport(0, 0, width, height)
        }
        override fun onDrawFrame(gl: GL10?) {
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        }
    }

    companion object Keys {
        const val forwardKey = 87
        const val leftKey = 65
        const val backKey = 83
        const val rightKey = 68
        const val jumpKey = 32
        const val attackKey = 1
    }
}
