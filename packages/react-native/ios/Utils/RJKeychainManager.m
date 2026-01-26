//
//  RJKeychainManager.m
//  Rejourney
//
//  Secure Keychain storage implementation.
//
//  Copyright (c) 2026 Rejourney
//

#import "RJKeychainManager.h"
#import "../Core/RJLogger.h"
#import <Security/Security.h>

static NSString *const kRJKeychainServiceName = @"com.rejourney.sdk";

@implementation RJKeychainManager

#pragma mark - Singleton

+ (instancetype)sharedManager {
  static RJKeychainManager *instance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[self alloc] init];
  });
  return instance;
}

#pragma mark - Query Building

- (NSMutableDictionary *)baseQueryForKey:(NSString *)key {
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : kRJKeychainServiceName,
    (__bridge id)kSecAttrAccount : key,
    (__bridge id)kSecAttrAccessible :
        (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
  } mutableCopy];
}

#pragma mark - Storage Operations

- (BOOL)setString:(NSString *)value forKey:(NSString *)key {
  if (!value || !key)
    return NO;

  
  [self deleteValueForKey:key];

  NSData *valueData = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (!valueData)
    return NO;

  NSMutableDictionary *query = [self baseQueryForKey:key];
  query[(__bridge id)kSecValueData] = valueData;

  OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);

  if (status == errSecSuccess) {
    RJLogDebug(@"Keychain: Stored value for key '%@'", key);
    return YES;
  } else {
    RJLogWarning(@"Keychain: Failed to store value for key '%@' (status: %d)",
                 key, (int)status);
    return NO;
  }
}

- (nullable NSString *)stringForKey:(NSString *)key {
  if (!key)
    return nil;

  NSMutableDictionary *query = [self baseQueryForKey:key];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

  CFDataRef dataRef = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query,
                                        (CFTypeRef *)&dataRef);

  if (status == errSecSuccess && dataRef) {
    NSData *data = (__bridge_transfer NSData *)dataRef;
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  }

  return nil;
}

- (BOOL)deleteValueForKey:(NSString *)key {
  if (!key)
    return NO;

  NSMutableDictionary *query = [self baseQueryForKey:key];
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);

  return status == errSecSuccess || status == errSecItemNotFound;
}

- (void)clearAll {
  NSDictionary *query = @{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : kRJKeychainServiceName
  };

  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
  if (status == errSecSuccess) {
    RJLogDebug(@"Keychain: Cleared all Rejourney items");
  }
}

@end
