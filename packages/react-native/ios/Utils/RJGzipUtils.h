//
//  RJGzipUtils.h
//  Rejourney
//
//  Gzip compression and Base64 decoding utilities.
//
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Gzip compress data using zlib (with gzip headers).
 *
 * @param input The data to compress.
 * @param error Optional pointer to receive error information.
 * @return The compressed data, or nil on failure.
 */
NSData *_Nullable RJGzipData(NSData *input, NSError **error);

/**
 * Decode base64 data from a data URI or plain base64 string.
 * Handles data URIs (removes "data:...;base64," prefix) and
 * delta prefixes ("delta:...").
 *
 * @param dataString The base64 string to decode.
 * @return The decoded data, or nil on failure.
 */
NSData *_Nullable RJDecodeBase64Data(NSString *dataString);

NS_ASSUME_NONNULL_END
