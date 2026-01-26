//
//  RJDeviceAuthManager.h
//  Rejourney
//
//  Device authentication using ECDSA keypairs
//  Copyright (c) 2026 Rejourney
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^RJDeviceAuthCompletionHandler)(
    BOOL success, NSString *_Nullable deviceCredentialId,
    NSError *_Nullable error);
typedef void (^RJDeviceTokenCompletionHandler)(BOOL success,
                                               NSString *_Nullable uploadToken,
                                               NSInteger expiresIn,
                                               NSError *_Nullable error);

@interface RJDeviceAuthManager : NSObject

/**
 * Shared instance for device authentication
 */
+ (instancetype)sharedManager;

/**
 * Register this device with the backend
 * Generates ECDSA keypair if needed and stores in Keychain
 *
 * @param projectPublicKey The project's public key (from SDK init)
 * @param bundleId The app's bundle identifier
 * @param platform Platform string ("ios")
 * @param sdkVersion SDK version string
 * @param apiUrl Base URL for backend API
 * @param completion Called with device credential ID on success
 */
- (void)registerDeviceWithProjectKey:(NSString *)projectPublicKey
                            bundleId:(NSString *)bundleId
                            platform:(NSString *)platform
                          sdkVersion:(NSString *)sdkVersion
                              apiUrl:(NSString *)apiUrl
                          completion:(RJDeviceAuthCompletionHandler)completion;

/**
 * Get an upload token for the current session
 * Performs challenge-response authentication
 *
 * @param completion Called with upload token on success
 */
- (void)getUploadTokenWithCompletion:(RJDeviceTokenCompletionHandler)completion;

/**
 * Get the stored device credential ID (if registered)
 */
- (nullable NSString *)deviceCredentialId;

/**
 * Get the current upload token (if valid)
 */
- (nullable NSString *)currentUploadToken;

/**
 * Check if upload token is still valid
 */
- (BOOL)hasValidUploadToken;

/**
 * Clear all stored authentication data (for testing/reset)
 */
- (void)clearAllAuthData;

/**
 * Check if registration parameters are configured (can auto-register)
 */
- (BOOL)canAutoRegister;

/**
 * Check if device is registered
 */
- (BOOL)isDeviceRegistered;

/**
 * Get upload token with automatic re-registration if device is not registered.
 * Uses stored registration parameters from the initial registerDeviceWithProjectKey call.
 *
 * @param completion Called with upload token on success
 */
- (void)getUploadTokenWithAutoRegisterCompletion:(RJDeviceTokenCompletionHandler)completion;

@end

NS_ASSUME_NONNULL_END
