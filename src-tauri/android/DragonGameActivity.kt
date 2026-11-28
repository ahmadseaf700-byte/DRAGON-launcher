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
        private const val FORWARD_KEY = 87
        private const val LEFT_KEY = 65
        private const val BACK_KEY = 83
        private const val RIGHT_KEY = 68
        private const val JUMP_KEY = 32
        private const val ATTACK_KEY = 1
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
        val jvmLibrary = File(File(runtimeDir), "lib/server/libjvm.so")

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
        frame.addView(panel, FrameLayout.LayoutParams(-1, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP))

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(12, 12, 12, 18)
        }
        listOf("W" to FORWARD_KEY, "A" to LEFT_KEY, "S" to BACK_KEY,
            "D" to RIGHT_KEY, "JUMP" to JUMP_KEY, "ATTACK" to ATTACK_KEY).forEach { (label, key) ->
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

        // Transparent right-side look pad. Events are queued for the future GLFW mouse callback.
        val lookPad = View(this).apply {
            var previousX = 0f
            var previousY = 0f
            setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        previousX = event.x
                        previousY = event.y
                        DragonInputQueue.push("look_start", 0, 0f, 0f)
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = event.x - previousX
                        val dy = event.y - previousY
                        previousX = event.x
                        previousY = event.y
                        DragonInputQueue.push("mouse_move", 0, dx, dy)
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                        DragonInputQueue.push("look_end", 0, 0f, 0f)
                }
                true
            }
        }
        frame.addView(lookPad, FrameLayout.LayoutParams(dp(190), dp(210), Gravity.END or Gravity.CENTER_VERTICAL))
        setContentView(frame)

        val nativeStatus = runCatching {
            System.loadLibrary("dragon_jvm_bridge")
            probeJvm(runtimeDir)
        }.getOrElse { "Native JVM probe unavailable: ${it.message}" }
        val packageStatus = if (jvmLibrary.isFile) "libjvm.so found" else "libjvm.so missing"
        status.text = "DRAGON Android engine bootstrap\nMinecraft: $versionId · RAM: $ramMb MB\n$packageStatus\n$nativeStatus\n\nThe Minecraft engine is not linked yet. This screen verifies the Android surface and touch-event queue only."
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

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
}
