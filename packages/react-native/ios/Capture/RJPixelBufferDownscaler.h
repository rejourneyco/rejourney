
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Utility for high-performance pixel buffer downscaling using vImage
 * (Accelerate). Moves scaling work off the main thread to avoid blocking UI.
 */
typedef NS_ENUM(NSInteger, RJDownscaleQuality) {
  RJDownscaleQualityBalanced = 0,
  RJDownscaleQualityHigh = 1,
};

@interface RJPixelBufferDownscaler : NSObject

/**
 * Downscales a source pixel buffer to target dimensions using vImage.
 *
 * @param src The source CVPixelBuffer (typically at native screen scale).
 * @param dstW The target width.
 * @param dstH The target height.
 * @param pool A pixel buffer pool configured for the target dimensions
 * (optional but recommended for perf).
 * @return A new CVPixelBuffer containing the scaled image, or NULL if failed.
 * Caller must release.
 */
+ (CVPixelBufferRef _Nullable)downscale:(CVPixelBufferRef)src
                                     toW:(size_t)dstW
                                     toH:(size_t)dstH
                               usingPool:(CVPixelBufferPoolRef _Nullable)pool;

+ (CVPixelBufferRef _Nullable)downscale:(CVPixelBufferRef)src
                                   toW:(size_t)dstW
                                   toH:(size_t)dstH
                             usingPool:(CVPixelBufferPoolRef _Nullable)pool
                                quality:(RJDownscaleQuality)quality;

@end

NS_ASSUME_NONNULL_END
