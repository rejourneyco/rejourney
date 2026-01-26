package com.rejourney.network

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Central provider for OkHttpClient instances.
 * SSL pinning has been removed — use the shared client below.
 */
object HttpClientProvider {
    val shared: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()
}
