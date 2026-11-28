package com.dragonlauncher.desktop

import java.util.concurrent.ConcurrentLinkedQueue

data class DragonInputEvent(
    val type: String,
    val code: Int,
    val x: Float,
    val y: Float,
    val timestampNanos: Long
)

/**
 * Thread-safe input handoff for the future GLFW/LWJGL callback bridge.
 * Events are queued here now; the Minecraft engine consumer is intentionally
 * not reported as connected until its native callbacks are integrated.
 */
object DragonInputQueue {
    private val events = ConcurrentLinkedQueue<DragonInputEvent>()

    fun push(type: String, code: Int, x: Float, y: Float) {
        events.offer(DragonInputEvent(type, code, x, y, System.nanoTime()))
    }

    fun poll(): DragonInputEvent? = events.poll()

    fun pendingCount(): Int = events.size
}
