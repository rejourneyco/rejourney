//
//  RJKeychainManager.h
//  Rejourney
//
//  Secure Keychain storage for sensitive credentials.
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

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Manages secure storage of sensitive data in iOS Keychain.
 */
@interface RJKeychainManager : NSObject

/// Shared instance
+ (instancetype)sharedManager;

/// Store a string value securely
- (BOOL)setString:(NSString *)value forKey:(NSString *)key;

/// Retrieve a string value
- (nullable NSString *)stringForKey:(NSString *)key;

/// Delete a value
- (BOOL)deleteValueForKey:(NSString *)key;

/// Clear all Rejourney keychain items
- (void)clearAll;

@end

NS_ASSUME_NONNULL_END
