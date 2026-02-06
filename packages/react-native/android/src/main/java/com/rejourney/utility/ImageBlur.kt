/**
 * Copyright 2026 Rejourney
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.rejourney.utility

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.renderscript.Allocation
import android.renderscript.Element
import android.renderscript.RenderScript
import android.renderscript.ScriptIntrinsicBlur
import android.content.Context
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Image blur utilities for privacy masking
 * Android implementation aligned with iOS ImageBlur.swift
 */
object ImageBlur {
    
    private const val MAX_BLUR_RADIUS = 25f // RenderScript limit
    private const val DEFAULT_BLUR_RADIUS = 15f
    
    /**
     * Apply Gaussian blur using RenderScript (fast, GPU-accelerated)
     * Falls back to box blur if RenderScript unavailable
     */
    @Suppress("DEPRECATION")
    fun applyGaussianBlur(
        context: Context,
        bitmap: Bitmap,
        radius: Float = DEFAULT_BLUR_RADIUS
    ): Bitmap {
        val safeRadius = min(radius, MAX_BLUR_RADIUS).coerceAtLeast(1f)
        
        return try {
            applyRenderScriptBlur(context, bitmap, safeRadius)
        } catch (e: Exception) {
            // Fallback to stack blur
            applyStackBlur(bitmap, safeRadius.toInt())
        }
    }
    
    /**
     * Apply RenderScript Gaussian blur (deprecated but still works)
     */
    @Suppress("DEPRECATION")
    private fun applyRenderScriptBlur(
        context: Context,
        bitmap: Bitmap,
        radius: Float
    ): Bitmap {
        val outputBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        
        val rs = RenderScript.create(context)
        val input = Allocation.createFromBitmap(rs, bitmap)
        val output = Allocation.createFromBitmap(rs, outputBitmap)
        
        val script = ScriptIntrinsicBlur.create(rs, Element.U8_4(rs))
        script.setRadius(radius)
        script.setInput(input)
        script.forEach(output)
        
        output.copyTo(outputBitmap)
        
        input.destroy()
        output.destroy()
        script.destroy()
        rs.destroy()
        
        return outputBitmap
    }
    
    /**
     * Stack blur algorithm (fallback for non-RenderScript devices)
     * Based on Mario Klingemann's algorithm
     */
    private fun applyStackBlur(bitmap: Bitmap, radius: Int): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)
        
        val wm = w - 1
        val hm = h - 1
        val wh = w * h
        val div = radius + radius + 1
        
        val r = IntArray(wh)
        val g = IntArray(wh)
        val b = IntArray(wh)
        
        var rsum: Int
        var gsum: Int
        var bsum: Int
        var x: Int
        var y: Int
        var i: Int
        var p: Int
        var yp: Int
        var yi: Int
        var yw: Int
        
        val vmin = IntArray(maxOf(w, h))
        
        var divsum = (div + 1) shr 1
        divsum *= divsum
        val dv = IntArray(256 * divsum)
        for (i in 0 until 256 * divsum) {
            dv[i] = i / divsum
        }
        
        yw = 0
        yi = 0
        
        val stack = Array(div) { IntArray(3) }
        var stackpointer: Int
        var stackstart: Int
        var sir: IntArray
        var rbs: Int
        val r1 = radius + 1
        var routsum: Int
        var goutsum: Int
        var boutsum: Int
        var rinsum: Int
        var ginsum: Int
        var binsum: Int
        
        y = 0
        while (y < h) {
            bsum = 0
            gsum = 0
            rsum = 0
            boutsum = 0
            goutsum = 0
            routsum = 0
            binsum = 0
            ginsum = 0
            rinsum = 0
            
            i = -radius
            while (i <= radius) {
                p = pixels[yi + minOf(wm, maxOf(i, 0))]
                sir = stack[i + radius]
                sir[0] = (p and 0xff0000) shr 16
                sir[1] = (p and 0x00ff00) shr 8
                sir[2] = p and 0x0000ff
                rbs = r1 - kotlin.math.abs(i)
                rsum += sir[0] * rbs
                gsum += sir[1] * rbs
                bsum += sir[2] * rbs
                if (i > 0) {
                    rinsum += sir[0]
                    ginsum += sir[1]
                    binsum += sir[2]
                } else {
                    routsum += sir[0]
                    goutsum += sir[1]
                    boutsum += sir[2]
                }
                i++
            }
            stackpointer = radius
            
            x = 0
            while (x < w) {
                r[yi] = dv[rsum]
                g[yi] = dv[gsum]
                b[yi] = dv[bsum]
                
                rsum -= routsum
                gsum -= goutsum
                bsum -= boutsum
                
                stackstart = stackpointer - radius + div
                sir = stack[stackstart % div]
                
                routsum -= sir[0]
                goutsum -= sir[1]
                boutsum -= sir[2]
                
                if (y == 0) {
                    vmin[x] = minOf(x + radius + 1, wm)
                }
                p = pixels[yw + vmin[x]]
                
                sir[0] = (p and 0xff0000) shr 16
                sir[1] = (p and 0x00ff00) shr 8
                sir[2] = p and 0x0000ff
                
                rinsum += sir[0]
                ginsum += sir[1]
                binsum += sir[2]
                
                rsum += rinsum
                gsum += ginsum
                bsum += binsum
                
                stackpointer = (stackpointer + 1) % div
                sir = stack[stackpointer % div]
                
                routsum += sir[0]
                goutsum += sir[1]
                boutsum += sir[2]
                
                rinsum -= sir[0]
                ginsum -= sir[1]
                binsum -= sir[2]
                
                yi++
                x++
            }
            yw += w
            y++
        }
        
        x = 0
        while (x < w) {
            bsum = 0
            gsum = 0
            rsum = 0
            boutsum = 0
            goutsum = 0
            routsum = 0
            binsum = 0
            ginsum = 0
            rinsum = 0
            
            yp = -radius * w
            
            i = -radius
            while (i <= radius) {
                yi = maxOf(0, yp) + x
                
                sir = stack[i + radius]
                
                sir[0] = r[yi]
                sir[1] = g[yi]
                sir[2] = b[yi]
                
                rbs = r1 - kotlin.math.abs(i)
                
                rsum += r[yi] * rbs
                gsum += g[yi] * rbs
                bsum += b[yi] * rbs
                
                if (i > 0) {
                    rinsum += sir[0]
                    ginsum += sir[1]
                    binsum += sir[2]
                } else {
                    routsum += sir[0]
                    goutsum += sir[1]
                    boutsum += sir[2]
                }
                
                if (i < hm) {
                    yp += w
                }
                i++
            }
            
            yi = x
            stackpointer = radius
            
            y = 0
            while (y < h) {
                pixels[yi] = (0xff000000.toInt() and pixels[yi]) or (dv[rsum] shl 16) or (dv[gsum] shl 8) or dv[bsum]
                
                rsum -= routsum
                gsum -= goutsum
                bsum -= boutsum
                
                stackstart = stackpointer - radius + div
                sir = stack[stackstart % div]
                
                routsum -= sir[0]
                goutsum -= sir[1]
                boutsum -= sir[2]
                
                if (x == 0) {
                    vmin[y] = minOf(y + r1, hm) * w
                }
                p = x + vmin[y]
                
                sir[0] = r[p]
                sir[1] = g[p]
                sir[2] = b[p]
                
                rinsum += sir[0]
                ginsum += sir[1]
                binsum += sir[2]
                
                rsum += rinsum
                gsum += ginsum
                bsum += binsum
                
                stackpointer = (stackpointer + 1) % div
                sir = stack[stackpointer]
                
                routsum += sir[0]
                goutsum += sir[1]
                boutsum += sir[2]
                
                rinsum -= sir[0]
                ginsum -= sir[1]
                binsum -= sir[2]
                
                yi += w
                y++
            }
            x++
        }
        
        val result = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        result.setPixels(pixels, 0, w, 0, 0, w, h)
        return result
    }
    
    /**
     * Apply pixelation blur (faster, for heavy privacy masking)
     */
    fun applyPixelation(bitmap: Bitmap, blockSize: Int = 10): Bitmap {
        val w = bitmap.width
        val h = bitmap.height
        
        val smallW = w / blockSize
        val smallH = h / blockSize
        
        // Scale down
        val small = Bitmap.createScaledBitmap(bitmap, smallW, smallH, false)
        
        // Scale back up with nearest neighbor
        val result = Bitmap.createScaledBitmap(small, w, h, false)
        
        small.recycle()
        
        return result
    }
    
    /**
     * Apply blur to a specific region of the bitmap
     */
    fun blurRegion(
        context: Context,
        bitmap: Bitmap,
        left: Int,
        top: Int,
        right: Int,
        bottom: Int,
        radius: Float = DEFAULT_BLUR_RADIUS
    ): Bitmap {
        val mutableBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        
        val safeLeft = left.coerceIn(0, bitmap.width)
        val safeTop = top.coerceIn(0, bitmap.height)
        val safeRight = right.coerceIn(safeLeft, bitmap.width)
        val safeBottom = bottom.coerceIn(safeTop, bitmap.height)
        
        val regionWidth = safeRight - safeLeft
        val regionHeight = safeBottom - safeTop
        
        if (regionWidth <= 0 || regionHeight <= 0) return mutableBitmap
        
        // Extract region
        val region = Bitmap.createBitmap(bitmap, safeLeft, safeTop, regionWidth, regionHeight)
        
        // Blur region
        val blurredRegion = applyGaussianBlur(context, region, radius)
        
        // Draw blurred region back
        val canvas = Canvas(mutableBitmap)
        canvas.drawBitmap(blurredRegion, safeLeft.toFloat(), safeTop.toFloat(), null)
        
        region.recycle()
        blurredRegion.recycle()
        
        return mutableBitmap
    }
}

/**
 * Extension function to blur bitmap
 */
fun Bitmap.blur(context: Context, radius: Float = 15f): Bitmap {
    return ImageBlur.applyGaussianBlur(context, this, radius)
}

/**
 * Extension function to pixelate bitmap
 */
fun Bitmap.pixelate(blockSize: Int = 10): Bitmap {
    return ImageBlur.applyPixelation(this, blockSize)
}
