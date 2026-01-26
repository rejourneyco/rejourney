/**
 * Utility to detect Android OEM (Original Equipment Manufacturer) and handle
 * OEM-specific quirks and behaviors.
 * 
 * Different OEMs have different behaviors for app lifecycle, especially around
 * task removal and service callbacks. This utility helps detect and handle
 * these differences.
 */
package com.rejourney.utils

import android.os.Build
import com.rejourney.core.Logger

object OEMDetector {
    
    enum class OEM {
        SAMSUNG,
        XIAOMI,
        HUAWEI,
        ONEPLUS,
        OPPO,
        VIVO,
        PIXEL,
        STOCK_ANDROID,
        UNKNOWN
    }
    
    private val oem: OEM by lazy {
        detectOEM()
    }
    
    /**
     * Get the detected OEM.
     */
    fun getOEM(): OEM = oem
    
    /**
     * Check if running on Samsung device.
     * Samsung has known bugs with onTaskRemoved() firing incorrectly.
     */
    fun isSamsung(): Boolean = oem == OEM.SAMSUNG
    
    /**
     * Check if running on Pixel or stock Android.
     * These devices generally have more reliable lifecycle callbacks.
     */
    fun isPixelOrStock(): Boolean = oem == OEM.PIXEL || oem == OEM.STOCK_ANDROID
    
    /**
     * Check if running on OEMs with aggressive task killing.
     * These OEMs may not reliably call onTaskRemoved().
     */
    fun hasAggressiveTaskKilling(): Boolean {
        return oem == OEM.XIAOMI || 
               oem == OEM.HUAWEI || 
               oem == OEM.OPPO || 
               oem == OEM.VIVO
    }
    
    /**
     * Check if onTaskRemoved() is likely to work reliably on this device.
     */
    fun isTaskRemovedReliable(): Boolean {
        // Pixel/Stock Android: Generally reliable
        if (isPixelOrStock()) return true
        
        // Samsung: Has bugs but sometimes works
        if (isSamsung()) return true // We'll add validation to filter false positives
        
        // Aggressive OEMs: Often don't call onTaskRemoved
        if (hasAggressiveTaskKilling()) return false
        
        // Unknown: Assume it might work
        return true
    }
    
    /**
     * Detect the OEM based on manufacturer and brand.
     */
    private fun detectOEM(): OEM {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val brand = Build.BRAND.lowercase()
        val model = Build.MODEL.lowercase()
        
        return when {
            // Samsung
            manufacturer.contains("samsung") || brand.contains("samsung") -> {
                Logger.debug("OEM detected: Samsung")
                OEM.SAMSUNG
            }
            
            // Xiaomi (includes Redmi, POCO)
            manufacturer.contains("xiaomi") || brand.contains("xiaomi") || 
            brand.contains("redmi") || brand.contains("poco") -> {
                Logger.debug("OEM detected: Xiaomi")
                OEM.XIAOMI
            }
            
            // Huawei (includes Honor)
            manufacturer.contains("huawei") || brand.contains("huawei") || 
            brand.contains("honor") -> {
                Logger.debug("OEM detected: Huawei")
                OEM.HUAWEI
            }
            
            // OnePlus
            manufacturer.contains("oneplus") || brand.contains("oneplus") -> {
                Logger.debug("OEM detected: OnePlus")
                OEM.ONEPLUS
            }
            
            // OPPO
            manufacturer.contains("oppo") || brand.contains("oppo") -> {
                Logger.debug("OEM detected: OPPO")
                OEM.OPPO
            }
            
            // Vivo
            manufacturer.contains("vivo") || brand.contains("vivo") -> {
                Logger.debug("OEM detected: Vivo")
                OEM.VIVO
            }
            
            // Google Pixel
            manufacturer.contains("google") && (model.contains("pixel") || brand.contains("google")) -> {
                Logger.debug("OEM detected: Pixel")
                OEM.PIXEL
            }
            
            // Stock Android (Google devices that aren't Pixel)
            manufacturer.contains("google") -> {
                Logger.debug("OEM detected: Stock Android")
                OEM.STOCK_ANDROID
            }
            
            else -> {
                Logger.debug("OEM detected: Unknown (manufacturer=$manufacturer, brand=$brand)")
                OEM.UNKNOWN
            }
        }
    }
    
    /**
     * Get OEM-specific recommendations for app termination detection.
     */
    fun getRecommendations(): String {
        return when (oem) {
            OEM.SAMSUNG -> "Samsung devices may have onTaskRemoved() fire incorrectly on app launch. Using validation to filter false positives."
            OEM.XIAOMI, OEM.HUAWEI, OEM.OPPO, OEM.VIVO -> "This OEM has aggressive task killing. onTaskRemoved() may not fire. Relying on ApplicationExitInfo and persistent state checks."
            OEM.PIXEL, OEM.STOCK_ANDROID -> "Stock Android - onTaskRemoved() should work reliably."
            else -> "Unknown OEM - using standard detection methods."
        }
    }
}
