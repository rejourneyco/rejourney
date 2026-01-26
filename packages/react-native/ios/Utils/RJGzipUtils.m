//
//  RJGzipUtils.m
//  Rejourney
//
//  Gzip compression and Base64 decoding utilities implementation.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJGzipUtils.h"
#import <zlib.h>

NSData *_Nullable RJGzipData(NSData *input, NSError **error) {
  if (!input || input.length == 0)
    return input;

  z_stream stream;
  stream.zalloc = Z_NULL;
  stream.zfree = Z_NULL;
  stream.opaque = Z_NULL;
  stream.next_in = (Bytef *)input.bytes;
  stream.avail_in = (uInt)input.length;

  
  if (deflateInit2(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8,
                   Z_DEFAULT_STRATEGY) != Z_OK) {
    if (error) {
      *error =
          [NSError errorWithDomain:@"com.rejourney.gzip"
                              code:-1
                          userInfo:@{
                            NSLocalizedDescriptionKey : @"Failed to init gzip"
                          }];
    }
    return nil;
  }

  NSMutableData *compressed =
      [NSMutableData dataWithLength:input.length * 1.1 + 32];

  int status;
  do {
    if (stream.total_out >= compressed.length) {
      [compressed increaseLengthBy:input.length / 2];
    }

    stream.next_out = (Bytef *)compressed.mutableBytes + stream.total_out;
    stream.avail_out = (uInt)(compressed.length - stream.total_out);

    status = deflate(&stream, Z_FINISH);
  } while (status == Z_OK);

  if (status != Z_STREAM_END) {
    deflateEnd(&stream);
    if (error) {
      *error =
          [NSError errorWithDomain:@"com.rejourney.gzip"
                              code:status
                          userInfo:@{
                            NSLocalizedDescriptionKey : @"Failed to gzip data"
                          }];
    }
    return nil;
  }

  deflateEnd(&stream);
  [compressed setLength:stream.total_out];
  return compressed;
}

NSData *_Nullable RJDecodeBase64Data(NSString *dataString) {
  if (!dataString || dataString.length == 0)
    return nil;

  NSString *clean = dataString;
  NSRange comma = [dataString rangeOfString:@","];
  if (comma.location != NSNotFound) {
    clean = [dataString substringFromIndex:comma.location + 1];
  }

  
  if ([clean hasPrefix:@"delta:"]) {
    clean = [clean substringFromIndex:6]; 
  }

  return [[NSData alloc]
      initWithBase64EncodedString:clean
                          options:NSDataBase64DecodingIgnoreUnknownCharacters];
}
