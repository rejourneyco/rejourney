//
//  RJViewSerializer.m
//  Rejourney
//
//  View hierarchy serializer implementation.
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

#import "RJViewSerializer.h"
#import "../Core/RJLogger.h"
#import "RJViewHierarchyScanner.h"

@implementation RJViewSerializer {
  Class _imageViewClass;
  Class _buttonClass;
  Class _switchClass;
  Class _scrollViewClass;
  Class _textFieldClass;
  Class _textViewClass;
  Class _controlClass;
  Class _sliderClass;
  Class _stepperClass;
  Class _segmentedControlClass;
  Class _datePickerClass;
  Class _pickerViewClass;
}

static NSMutableDictionary *classNameCache = nil;

#pragma mark - Initialization

+ (void)initialize {
  if (self == [RJViewSerializer class]) {
    classNameCache = [NSMutableDictionary new];
  }
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _enabled = YES;
    _maxDepth = 10; // Aggressive optimization
    _includeVisualProperties = YES;
    _includeTextContent = YES;

    _imageViewClass = [UIImageView class];
    _buttonClass = [UIButton class];
    _switchClass = [UISwitch class];
    _scrollViewClass = [UIScrollView class];
    _textFieldClass = [UITextField class];
    _textViewClass = [UITextView class];
    _controlClass = [UIControl class];
    _sliderClass = [UISlider class];
    _stepperClass = [UIStepper class];
    _segmentedControlClass = [UISegmentedControl class];
    _datePickerClass = [UIDatePicker class];
    _pickerViewClass = [UIPickerView class];
  }
  return self;
}

#pragma mark - Public Methods

- (NSDictionary *)serializeWindow:(UIWindow *)window {
  return [self serializeWindow:window withScanResult:nil];
}

- (NSDictionary *)serializeWindow:(UIWindow *)window
                   withScanResult:(RJViewHierarchyScanResult *)scanResult {
  if (!self.enabled || !window) {
    return @{};
  }

  @try {
    NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970] * 1000;
    CGFloat scale = [UIScreen mainScreen].scale;

    UIView *rootView = window.rootViewController.view ?: window;

    // Sanitize window bounds to prevent NaN in output
    CGFloat winWidth = window.bounds.size.width;
    CGFloat winHeight = window.bounds.size.height;
    if (isnan(winWidth) || isinf(winWidth))
      winWidth = 0;
    if (isnan(winHeight) || isinf(winHeight))
      winHeight = 0;
    if (isnan(scale) || isinf(scale))
      scale = 1;

    NSTimeInterval scanStartTime = CACurrentMediaTime();
    NSDictionary *rootNode = [self serializeViewInternal:rootView
                                                   depth:0
                                               startTime:scanStartTime];

    NSMutableDictionary *result = [@{
      @"timestamp" : @(timestamp),
      @"screen" : @{
        @"width" : @(winWidth),
        @"height" : @(winHeight),
        @"scale" : @(scale),
      },
      @"root" : rootNode ?: @{},
    } mutableCopy];

    if (scanResult && scanResult.layoutSignature) {
      result[@"layoutSignature"] = scanResult.layoutSignature;
    }

    return result;
  } @catch (NSException *exception) {
    RJLogError(@"View serialization failed: %@", exception);
    return @{
      @"timestamp" : @([[NSDate date] timeIntervalSince1970] * 1000),
      @"error" : exception.reason ?: @"Unknown error",
    };
  }
}

- (NSDictionary *)serializeView:(UIView *)view {
  if (!self.enabled || !view) {
    return @{};
  }
  NSTimeInterval scanStartTime = CACurrentMediaTime();
  return [self serializeViewInternal:view depth:0 startTime:scanStartTime];
}

- (NSDictionary *)viewInfoAtPoint:(CGPoint)point inWindow:(UIWindow *)window {
  if (!window)
    return nil;

  UIView *hitView = [window hitTest:point withEvent:nil];
  if (!hitView)
    return nil;

  return [self createViewInfoForView:hitView];
}

#pragma mark - Private Methods

// Helper to sanitize CGFloat values for CoreGraphics safety
static inline CGFloat RJSanitizeCGFloat(CGFloat value) {
  if (isnan(value) || isinf(value)) {
    return 0;
  }
  return value;
}

- (NSDictionary *)serializeViewInternal:(UIView *)view
                                  depth:(NSInteger)depth
                              startTime:(NSTimeInterval)startTime {
  if (!view || depth > self.maxDepth) {
    return @{};
  }

  // PERFORMANCE BAILOUT: If we've been scanning for > 10ms, stop recursion to
  // avoid main-thread hang. This allows us to return a partial tree instead of
  // freezing the app.
  if (CACurrentMediaTime() - startTime > 0.010) {
    return @{@"type" : NSStringFromClass([view class]), @"bailout" : @YES};
  }

  NSMutableDictionary *node = [NSMutableDictionary dictionaryWithCapacity:12];

  static NSString *kType = @"type";
  static NSString *kFrame = @"frame";
  static NSString *kHidden = @"hidden";
  static NSString *kAlpha = @"alpha";
  static NSString *kTestID = @"testID";
  static NSString *kLabel = @"label";
  static NSString *kMasked = @"masked";
  static NSString *kBg = @"bg";
  static NSString *kCornerRadius = @"cornerRadius";
  static NSString *kBorderWidth = @"borderWidth";
  static NSString *kText = @"text";
  static NSString *kTextLength = @"textLength";
  static NSString *kHasImage = @"hasImage";
  static NSString *kImageLabel = @"imageLabel";
  static NSString *kInteractive = @"interactive";
  static NSString *kButtonTitle = @"buttonTitle";
  static NSString *kEnabled = @"enabled";
  static NSString *kSwitchOn = @"switchOn";
  static NSString *kContentOffset = @"contentOffset";
  static NSString *kContentSize = @"contentSize";
  static NSString *kChildren = @"children";

  Class viewClass = [view class];
  NSString *className = classNameCache[(id<NSCopying>)viewClass];
  if (!className) {
    className = NSStringFromClass(viewClass);
    classNameCache[(id<NSCopying>)viewClass] = className;
  }
  node[kType] = className;

  CGRect frame = view.frame;
  node[kFrame] = @{
    @"x" : @(RJSanitizeCGFloat(frame.origin.x)),
    @"y" : @(RJSanitizeCGFloat(frame.origin.y)),
    @"w" : @(RJSanitizeCGFloat(frame.size.width)),
    @"h" : @(RJSanitizeCGFloat(frame.size.height)),
  };

  if (view.hidden) {
    node[kHidden] = @YES;
  }
  if (view.alpha < 1.0) {
    node[kAlpha] = @(view.alpha);
  }

  if (view.accessibilityIdentifier.length > 0) {
    node[kTestID] = view.accessibilityIdentifier;
  }
  if (view.accessibilityLabel.length > 0) {
    node[kLabel] = view.accessibilityLabel;
  }

  if ([self isSensitiveView:view]) {
    node[kMasked] = @YES;
  }

  if (self.includeVisualProperties) {
    if (view.backgroundColor &&
        ![view.backgroundColor isEqual:[UIColor clearColor]]) {
      node[kBg] = [self colorToHex:view.backgroundColor];
    }

    if (view.layer.cornerRadius > 0) {
      node[kCornerRadius] = @(view.layer.cornerRadius);
    }

    if (view.layer.borderWidth > 0) {
      node[kBorderWidth] = @(view.layer.borderWidth);
    }
  }

  if (self.includeTextContent) {
    NSString *text = [self extractTextFromView:view];
    if (text.length > 0) {
      node[kText] = [self maskText:text];
      node[kTextLength] = @(text.length);
    }
  }

  if ([view isKindOfClass:_imageViewClass]) {
    node[kHasImage] = @YES;
    UIImageView *imageView = (UIImageView *)view;
    if (imageView.accessibilityLabel.length > 0) {
      node[kImageLabel] = imageView.accessibilityLabel;
    }
  }

  if ([self isInteractiveView:view]) {
    node[kInteractive] = @YES;

    if ([view isKindOfClass:_buttonClass]) {
      UIButton *button = (UIButton *)view;
      NSString *title = button.currentTitle;
      if (title.length > 0) {
        node[kButtonTitle] = title;
      }
      node[kEnabled] = @(button.enabled);
    }

    if ([view isKindOfClass:_switchClass]) {
      UISwitch *sw = (UISwitch *)view;
      node[kSwitchOn] = @(sw.isOn);
    }
  }

  if ([view isKindOfClass:_scrollViewClass]) {
    UIScrollView *scrollView = (UIScrollView *)view;
    node[kContentOffset] = @{
      @"x" : @(RJSanitizeCGFloat(scrollView.contentOffset.x)),
      @"y" : @(RJSanitizeCGFloat(scrollView.contentOffset.y)),
    };
    node[kContentSize] = @{
      @"w" : @(RJSanitizeCGFloat(scrollView.contentSize.width)),
      @"h" : @(RJSanitizeCGFloat(scrollView.contentSize.height)),
    };
  }

  NSMutableArray *children =
      [NSMutableArray arrayWithCapacity:view.subviews.count];
  CGRect parentBounds = view.bounds;
  for (UIView *child in [view.subviews reverseObjectEnumerator]) {
    if (child.hidden || child.alpha <= 0.01) {
      continue;
    }

    if (child.frame.size.width <= 0 || child.frame.size.height <= 0) {
      continue;
    }

    NSDictionary *childNode = [self serializeViewInternal:child
                                                    depth:depth + 1
                                                startTime:startTime];
    if (childNode.count > 0) {
      [children insertObject:childNode atIndex:0];
    }

    if (child.opaque && child.alpha >= 1.0 &&
        CGRectEqualToRect(child.frame, parentBounds)) {
      break;
    }
  }

  if (children.count > 0) {
    node[kChildren] = children;
  }

  return node;
}

- (NSDictionary *)createViewInfoForView:(UIView *)view {
  if (!view)
    return nil;

  NSMutableDictionary *info = [NSMutableDictionary dictionaryWithCapacity:5];

  static NSString *kType = @"type";
  static NSString *kTestID = @"testID";
  static NSString *kLabel = @"label";
  static NSString *kFrame = @"frame";
  static NSString *kInteractive = @"interactive";

  Class viewClass = [view class];
  NSString *className = classNameCache[(id<NSCopying>)viewClass];
  if (!className) {
    className = NSStringFromClass(viewClass);
    classNameCache[(id<NSCopying>)viewClass] = className;
  }
  info[kType] = className;

  if (view.accessibilityIdentifier.length > 0) {
    info[kTestID] = view.accessibilityIdentifier;
  }
  if (view.accessibilityLabel.length > 0) {
    info[kLabel] = view.accessibilityLabel;
  }

  // Sanitize frame values to prevent NaN/Inf
  CGRect frame = view.frame;
  info[kFrame] = @{
    @"x" : @(RJSanitizeCGFloat(frame.origin.x)),
    @"y" : @(RJSanitizeCGFloat(frame.origin.y)),
    @"w" : @(RJSanitizeCGFloat(frame.size.width)),
    @"h" : @(RJSanitizeCGFloat(frame.size.height)),
  };

  if ([self isInteractiveView:view]) {
    info[kInteractive] = @YES;
  }

  return info;
}

#pragma mark - Helpers

- (BOOL)isSensitiveView:(UIView *)view {
  if ([view isKindOfClass:[UITextField class]]) {
    UITextField *textField = (UITextField *)view;
    if (textField.isSecureTextEntry)
      return YES;
    UIKeyboardType kbType = textField.keyboardType;
    if (kbType == UIKeyboardTypeNumberPad || kbType == UIKeyboardTypePhonePad ||
        kbType == UIKeyboardTypeEmailAddress ||
        kbType == UIKeyboardTypeDecimalPad) {
      return YES;
    }
    UITextContentType contentType = textField.textContentType;
    if (contentType) {
      if ([contentType isEqualToString:UITextContentTypePassword] ||
          [contentType isEqualToString:UITextContentTypeNewPassword] ||
          [contentType isEqualToString:UITextContentTypeOneTimeCode] ||
          [contentType isEqualToString:UITextContentTypeCreditCardNumber]) {
        return YES;
      }
    }
    return NO;
  }

  if ([view isKindOfClass:[UITextView class]]) {
    UITextView *textView = (UITextView *)view;
    if (textView.isSecureTextEntry)
      return YES;
    UITextContentType contentType = textView.textContentType;
    if (contentType) {
      if ([contentType isEqualToString:UITextContentTypePassword] ||
          [contentType isEqualToString:UITextContentTypeNewPassword] ||
          [contentType isEqualToString:UITextContentTypeOneTimeCode] ||
          [contentType isEqualToString:UITextContentTypeCreditCardNumber]) {
        return YES;
      }
    }
    return NO;
  }

  Class viewClass = [view class];
  NSString *className = classNameCache[(id<NSCopying>)viewClass];
  if (!className) {
    className = NSStringFromClass(viewClass);
    classNameCache[(id<NSCopying>)viewClass] = className;
  }
  if ([className containsString:@"Password"] ||
      [className containsString:@"Secure"] ||
      [className containsString:@"Credit"] ||
      [className containsString:@"Card"] || [className containsString:@"SSN"] ||
      [className containsString:@"CVV"] || [className containsString:@"CVC"] ||
      [className containsString:@"PIN"]) {
    return YES;
  }

  if (view.accessibilityTraits & UIAccessibilityTraitKeyboardKey) {
    return YES;
  }

  return NO;
}

- (BOOL)isInteractiveView:(UIView *)view {

  return [view isKindOfClass:[UIControl class]] ||
         [view isKindOfClass:[UITextView class]] ||
         (view.gestureRecognizers.count > 0);
}

- (NSString *)extractTextFromView:(UIView *)view {
  @try {
    if ([view respondsToSelector:@selector(text)]) {
      id text = [view performSelector:@selector(text)];
      if ([text isKindOfClass:[NSString class]]) {
        return text;
      }
    }

    if ([view respondsToSelector:@selector(attributedText)]) {
      id attrText = [view performSelector:@selector(attributedText)];
      if ([attrText isKindOfClass:[NSAttributedString class]]) {
        return [(NSAttributedString *)attrText string];
      }
    }
  } @catch (NSException *exception) {
    return nil;
  }

  if ([view isKindOfClass:[UIButton class]]) {
    return [(UIButton *)view currentTitle];
  }

  return nil;
}

- (NSString *)maskText:(NSString *)text {
  if (!text || text.length == 0) {
    return @"";
  }

  NSInteger maskLength = MIN(text.length, 12);
  NSMutableString *masked = [NSMutableString stringWithCapacity:maskLength];
  for (NSInteger i = 0; i < maskLength; i++) {
    [masked appendString:@"•"];
  }

  return masked;
}

- (NSString *)colorToHex:(UIColor *)color {
  if (!color)
    return nil;

  CGFloat r, g, b, a;
  if (![color getRed:&r green:&g blue:&b alpha:&a]) {

    CGFloat white;
    if ([color getWhite:&white alpha:&a]) {
      r = g = b = white;
    } else {
      return nil;
    }
  }

  return [NSString stringWithFormat:@"#%02X%02X%02X", (int)(r * 255),
                                    (int)(g * 255), (int)(b * 255)];
}

@end
