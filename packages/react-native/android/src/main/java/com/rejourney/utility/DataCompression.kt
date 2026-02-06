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

import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/**
 * Data compression utilities
 * Android implementation aligned with iOS DataCompression.swift
 */
object DataCompression {
    
    /**
     * Compress data using gzip
     */
    fun gzipCompress(data: ByteArray): ByteArray? {
        return try {
            val bos = ByteArrayOutputStream()
            GZIPOutputStream(bos).use { gzip ->
                gzip.write(data)
            }
            bos.toByteArray()
        } catch (e: Exception) {
            null
        }
    }
    
    /**
     * Compress string using gzip
     */
    fun gzipCompress(text: String): ByteArray? {
        return gzipCompress(text.toByteArray(Charsets.UTF_8))
    }
}

/**
 * Extension function for ByteArray gzip compression
 */
fun ByteArray.gzipCompress(): ByteArray? {
    return DataCompression.gzipCompress(this)
}

/**
 * Extension function for String gzip compression
 */
fun String.gzipCompress(): ByteArray? {
    return DataCompression.gzipCompress(this)
}
