package com.rejourney.recording

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.util.UUID

/**
 * Native OkHttp Interceptor for Rejourney
 *
 * Captures native network traffic and routes it to the Rejourney TelemetryPipeline.
 * To use, add this interceptor to your native OkHttpClient:
 * val client = OkHttpClient.Builder()
 *     .addInterceptor(RejourneyNetworkInterceptor())
 *     .build()
 */
class RejourneyNetworkInterceptor : Interceptor {

    @Throws(IOException::class)
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val host = request.url.host

        // Skip Rejourney's own API traffic to avoid ingestion duplication (mirrors iOS RejourneyURLProtocol)
        if (host.contains("api.rejourney.co") || host.contains("rejourney")) {
            return chain.proceed(request)
        }

        val startMs = System.currentTimeMillis()

        var response: Response? = null
        var error: Exception? = null

        try {
            response = chain.proceed(request)
        } catch (e: Exception) {
            error = e
            throw e
        } finally {
            try {
                val endMs = System.currentTimeMillis()
                val duration = endMs - startMs

                val isSuccess = response?.isSuccessful == true
                val statusCode = response?.code ?: 0

                val urlStr = request.url.toString()
                val pathStr = request.url.encodedPath

                var maxUrlStr = urlStr
                if (maxUrlStr.length > 300) {
                    maxUrlStr = maxUrlStr.substring(0, 300)
                }

                val reqSize = request.body?.contentLength()?.takeIf { it >= 0 }?.toInt() ?: 0
                val resSize = response?.body?.contentLength()?.takeIf { it >= 0 }?.toInt() ?: 0

                val event = mutableMapOf<String, Any>(
                    "requestId" to "n_${UUID.randomUUID()}",
                    "method" to request.method,
                    "url" to maxUrlStr,
                    "urlPath" to pathStr,
                    "urlHost" to request.url.host,
                    "statusCode" to statusCode,
                    "duration" to duration,
                    "startTimestamp" to startMs,
                    "endTimestamp" to endMs,
                    "success" to isSuccess
                )

                if (reqSize > 0) {
                    event["requestBodySize"] = reqSize
                }
                
                request.body?.contentType()?.let {
                    event["requestContentType"] = it.toString()
                }

                if (resSize > 0) {
                    event["responseBodySize"] = resSize
                }
                
                response?.body?.contentType()?.let {
                    event["responseContentType"] = it.toString()
                }

                error?.let {
                    event["errorMessage"] = it.message ?: "Network error"
                }

                TelemetryPipeline.shared?.recordNetworkEvent(event)

            } catch (ignore: Exception) {
                // Ignore to avoid breaking the application network call
            }
        }

        return response!!
    }
}
