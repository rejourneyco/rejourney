//
//  RJWindowUtils.m
//  Rejourney
//
//  Window and view utility functions implementation.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJWindowUtils.h"

@implementation RJWindowUtils

static __weak UIWindow *_cachedKeyWindow = nil;
static NSTimeInterval _lastCacheTime = 0;
static const NSTimeInterval kKeyWindowCacheTTL = 0.5; // Cache for 500ms

+ (UIWindow *)keyWindow {
  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  if (_cachedKeyWindow && (now - _lastCacheTime < kKeyWindowCacheTTL)) {
    return _cachedKeyWindow;
  }

  UIWindow *window = [self findKeyWindowInternal];
  _cachedKeyWindow = window;
  _lastCacheTime = now;
  return window;
}

+ (UIWindow *)findKeyWindowInternal {
  if (@available(iOS 13.0, *)) {
    UIWindow *bestKeyApp = nil;
    CGFloat bestKeyAppLevel = -CGFLOAT_MAX;
    UIWindow *bestApp = nil;
    CGFloat bestAppLevel = -CGFLOAT_MAX;
    UIWindow *anyKey = nil;

    for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
      if (![scene isKindOfClass:[UIWindowScene class]]) {
        continue;
      }
      UIWindowScene *windowScene = (UIWindowScene *)scene;
      if (windowScene.activationState !=
          UISceneActivationStateForegroundActive) {
        continue;
      }

      for (UIWindow *window in windowScene.windows) {
        if (!window || window.isHidden || window.alpha <= 0.01) {
          continue;
        }

        NSString *cls = NSStringFromClass([window class]);
        BOOL isSystemInputWindow = ([cls containsString:@"Keyboard"] ||
                                    [cls containsString:@"TextEffects"] ||
                                    [cls containsString:@"InputWindow"] ||
                                    [cls containsString:@"RemoteKeyboard"]);

        BOOL hasRoot = (window.rootViewController != nil);
        BOOL isAppCandidate = (!isSystemInputWindow && hasRoot);
        CGFloat level = window.windowLevel;

        if (window.isKeyWindow) {
          if (!anyKey) {
            anyKey = window;
          }
          if (isAppCandidate && level > bestKeyAppLevel) {
            bestKeyAppLevel = level;
            bestKeyApp = window;
          }
        }

        if (isAppCandidate && level > bestAppLevel) {
          bestAppLevel = level;
          bestApp = window;
        }
      }
    }

    if (bestKeyApp) {
      return bestKeyApp;
    }
    if (bestApp) {
      return bestApp;
    }
    if (anyKey) {
      return anyKey;
    }
  } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    return [UIApplication sharedApplication].keyWindow;
#pragma clang diagnostic pop
  }
  return nil;
}

+ (NSString *)accessibilityLabelForView:(UIView *)view {
  UIView *current = view;
  while (current) {
    if (current.accessibilityLabel.length > 0) {
      return current.accessibilityLabel;
    }
    current = current.superview;
  }
  return nil;
}

+ (NSString *)generateSessionId {
  NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970];
  NSString *timestampStr =
      [NSString stringWithFormat:@"%.0f", timestamp * 1000];
  NSString *randomHex = [NSString stringWithFormat:@"%08X", arc4random()];
  return [NSString stringWithFormat:@"session_%@_%@", timestampStr, randomHex];
}

+ (NSTimeInterval)currentTimestampMillis {
  return [[NSDate date] timeIntervalSince1970] * 1000;
}

@end
