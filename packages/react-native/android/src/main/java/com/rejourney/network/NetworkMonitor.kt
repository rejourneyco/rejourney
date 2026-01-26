/**
 * Network state monitoring.
 * Ported from iOS RJNetworkMonitor.
 */
package com.rejourney.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.telephony.TelephonyManager
import com.rejourney.core.Logger

/**
 * Callback interface for network state changes.
 */
interface NetworkMonitorListener {
    fun onNetworkChanged(quality: NetworkQuality)
}

enum class NetworkType {
    NONE,
    WIFI,
    CELLULAR,
    WIRED,
    OTHER
}

enum class CellularGeneration {
    UNKNOWN,
    G2,
    G3,
    G4,
    G5
}

data class NetworkQuality(
    val networkType: NetworkType = NetworkType.NONE,
    val cellularGeneration: CellularGeneration = CellularGeneration.UNKNOWN,
    val isConstrained: Boolean = false,
    val isExpensive: Boolean = false,
    val timestamp: Long = System.currentTimeMillis()
) {
    fun toMap(): Map<String, Any> {
        val networkTypeString = when (networkType) {
            NetworkType.WIFI -> "wifi"
            NetworkType.CELLULAR -> "cellular"
            NetworkType.WIRED -> "wired"
            NetworkType.OTHER -> "other"
            NetworkType.NONE -> "none"
        }

        val cellularString = when (cellularGeneration) {
            CellularGeneration.G2 -> "2G"
            CellularGeneration.G3 -> "3G"
            CellularGeneration.G4 -> "4G"
            CellularGeneration.G5 -> "5G"
            CellularGeneration.UNKNOWN -> "unknown"
        }

        return mapOf(
            "networkType" to networkTypeString,
            "cellularGeneration" to cellularString,
            "isConstrained" to isConstrained,
            "isExpensive" to isExpensive,
            "timestamp" to timestamp
        )
    }
}

class NetworkMonitor private constructor(private val context: Context) {

    companion object {
        @Volatile
        private var instance: NetworkMonitor? = null

        fun getInstance(context: Context): NetworkMonitor {
            return instance ?: synchronized(this) {
                instance ?: NetworkMonitor(context.applicationContext).also { instance = it }
            }
        }
    }

    var listener: NetworkMonitorListener? = null
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var telephonyManager: TelephonyManager? = null
    @Volatile
    var currentQuality: NetworkQuality = NetworkQuality()
        private set
    
    @Volatile
    var isConnected: Boolean = false
        private set
    
    @Volatile
    var isWifi: Boolean = false
        private set
    
    @Volatile
    var isCellular: Boolean = false
        private set

    fun startMonitoring() {
        try {
            connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager

            updateCurrentNetworkState()
            listener?.onNetworkChanged(currentQuality)

            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    updateCurrentNetworkState()
                    listener?.onNetworkChanged(currentQuality)
                    Logger.debug("Network changed: ${currentQuality.toMap()}")
                }

                override fun onLost(network: Network) {
                    updateQuality(
                        NetworkType.NONE,
                        CellularGeneration.UNKNOWN,
                        isConstrained = false,
                        isExpensive = false
                    )
                    listener?.onNetworkChanged(currentQuality)
                    Logger.debug("Network lost")
                }

                override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) {
                    updateNetworkCapabilities(networkCapabilities)
                    listener?.onNetworkChanged(currentQuality)
                }
            }

            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            connectivityManager?.registerNetworkCallback(request, networkCallback!!)
            Logger.debug("Network monitoring started")
        } catch (e: Exception) {
            Logger.error("Failed to start network monitoring", e)
        }
    }

    fun stopMonitoring() {
        try {
            networkCallback?.let { callback ->
                connectivityManager?.unregisterNetworkCallback(callback)
            }
            networkCallback = null
            Logger.debug("Network monitoring stopped")
        } catch (e: Exception) {
            Logger.error("Failed to stop network monitoring", e)
        }
    }

    private fun updateCurrentNetworkState() {
        try {
            val activeNetwork = connectivityManager?.activeNetwork
            if (activeNetwork != null) {
                val capabilities = connectivityManager?.getNetworkCapabilities(activeNetwork)
                if (capabilities != null) {
                    updateNetworkCapabilities(capabilities)
                    return
                }
            }
            updateQuality(NetworkType.NONE, CellularGeneration.UNKNOWN, false, false)
        } catch (e: Exception) {
            Logger.error("Failed to update network state", e)
        }
    }

    private fun updateNetworkCapabilities(capabilities: NetworkCapabilities) {
        val networkType = when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkType.WIFI
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkType.CELLULAR
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkType.WIRED
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> NetworkType.OTHER
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) -> NetworkType.OTHER
            else -> NetworkType.NONE
        }

        val cellularGeneration = if (networkType == NetworkType.CELLULAR) {
            mapCellularGeneration(telephonyManager?.dataNetworkType)
        } else {
            CellularGeneration.UNKNOWN
        }

        val temporarilyNotMetered = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED)
        } else {
            false
        }
        val isExpensive = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) &&
            !temporarilyNotMetered

        val restricted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
        } else {
            false
        }

        val backgroundRestricted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            connectivityManager?.restrictBackgroundStatus ==
                ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
        } else {
            false
        }

        updateQuality(networkType, cellularGeneration, restricted || backgroundRestricted, isExpensive)
    }

    fun captureNetworkQuality(): NetworkQuality = currentQuality

    /**
     * Check if network is suitable for uploads (connected and preferably on wifi).
     */
    fun isSuitableForUpload(): Boolean = isConnected

    /**
     * Check if network is suitable for large uploads (wifi preferred).
     */
    fun isSuitableForLargeUpload(): Boolean = isConnected && isWifi

    private fun updateQuality(
        networkType: NetworkType,
        cellularGeneration: CellularGeneration,
        isConstrained: Boolean,
        isExpensive: Boolean
    ) {
        currentQuality = NetworkQuality(
            networkType = networkType,
            cellularGeneration = cellularGeneration,
            isConstrained = isConstrained,
            isExpensive = isExpensive,
            timestamp = System.currentTimeMillis()
        )
        isConnected = networkType != NetworkType.NONE
        isWifi = networkType == NetworkType.WIFI
        isCellular = networkType == NetworkType.CELLULAR
    }

    private fun mapCellularGeneration(networkType: Int?): CellularGeneration {
        return when (networkType) {
            TelephonyManager.NETWORK_TYPE_GPRS,
            TelephonyManager.NETWORK_TYPE_EDGE,
            TelephonyManager.NETWORK_TYPE_CDMA,
            TelephonyManager.NETWORK_TYPE_1xRTT,
            TelephonyManager.NETWORK_TYPE_IDEN -> CellularGeneration.G2
            TelephonyManager.NETWORK_TYPE_UMTS,
            TelephonyManager.NETWORK_TYPE_EVDO_0,
            TelephonyManager.NETWORK_TYPE_EVDO_A,
            TelephonyManager.NETWORK_TYPE_HSDPA,
            TelephonyManager.NETWORK_TYPE_HSUPA,
            TelephonyManager.NETWORK_TYPE_HSPA,
            TelephonyManager.NETWORK_TYPE_EVDO_B,
            TelephonyManager.NETWORK_TYPE_EHRPD,
            TelephonyManager.NETWORK_TYPE_HSPAP -> CellularGeneration.G3
            TelephonyManager.NETWORK_TYPE_LTE,
            TelephonyManager.NETWORK_TYPE_LTE -> CellularGeneration.G4
            TelephonyManager.NETWORK_TYPE_NR -> CellularGeneration.G5
            else -> CellularGeneration.UNKNOWN
        }
    }
}
