
#import "RJPixelBufferDownscaler.h"
#import <Accelerate/Accelerate.h>

@implementation RJPixelBufferDownscaler

+ (CVPixelBufferRef)downscale:(CVPixelBufferRef)src
                          toW:(size_t)dstW
                          toH:(size_t)dstH
                    usingPool:(CVPixelBufferPoolRef)pool {
  return [self downscale:src
                     toW:dstW
                     toH:dstH
               usingPool:pool
                  quality:RJDownscaleQualityBalanced];
}

+ (CVPixelBufferRef)downscale:(CVPixelBufferRef)src
                           toW:(size_t)dstW
                           toH:(size_t)dstH
                     usingPool:(CVPixelBufferPoolRef)pool
                        quality:(RJDownscaleQuality)quality {

  if (!src)
    return NULL;

  CVPixelBufferRef dst = NULL;
  CVReturn status = kCVReturnError;

  if (pool) {
    status = CVPixelBufferPoolCreatePixelBuffer(NULL, pool, &dst);
  }

  if (status != kCVReturnSuccess || !dst) {
    NSDictionary *options = @{
      (id)kCVPixelBufferCGImageCompatibilityKey : @YES,
      (id)kCVPixelBufferCGBitmapContextCompatibilityKey : @YES,
    };

    status = CVPixelBufferCreate(
        kCFAllocatorDefault, dstW, dstH,
        CVPixelBufferGetPixelFormatType(src),
        (__bridge CFDictionaryRef)options, &dst);
  }

  if (status != kCVReturnSuccess || !dst) {
    return NULL;
  }

  CVPixelBufferLockBaseAddress(src, kCVPixelBufferLock_ReadOnly);
  CVPixelBufferLockBaseAddress(dst, 0);

  vImage_Buffer srcBuf = {
      .data = CVPixelBufferGetBaseAddress(src),
      .height = CVPixelBufferGetHeight(src),
      .width = CVPixelBufferGetWidth(src),
      .rowBytes = CVPixelBufferGetBytesPerRow(src),
  };

  vImage_Buffer dstBuf = {
      .data = CVPixelBufferGetBaseAddress(dst),
      .height = dstH,
      .width = dstW,
      .rowBytes = CVPixelBufferGetBytesPerRow(dst),
  };

  vImage_Flags flags = kvImageDoNotTile;
  if (quality == RJDownscaleQualityHigh) {
    flags |= kvImageHighQualityResampling;
  }

  vImage_Error error = vImageScale_ARGB8888(&srcBuf, &dstBuf, NULL, flags);

  CVPixelBufferUnlockBaseAddress(dst, 0);
  CVPixelBufferUnlockBaseAddress(src, kCVPixelBufferLock_ReadOnly);

  if (error != kvImageNoError) {
    CVPixelBufferRelease(dst);
    return NULL;
  }

  return dst;
}

@end
