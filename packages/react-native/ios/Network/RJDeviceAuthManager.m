//
//  RJDeviceAuthManager.m
//  Rejourney
//
//  Device authentication using ECDSA keypairs
//  Copyright (c) 2026 Rejourney
//

#import "RJDeviceAuthManager.h"
#import "../Core/RJLogger.h"
#import "../Utils/RJKeychainManager.h"
#import <Security/Security.h>

static NSString *const kKeychainKeyTag = @"com.rejourney.devicekey";
static NSString *const kKeychainAccessGroup = nil;
static NSString *const kDeviceCredentialKey = @"RJDeviceCredentialId";
static NSString *const kUploadTokenKey = @"RJUploadToken";
static NSString *const kUploadTokenExpiryKey = @"RJUploadTokenExpiry";

@interface RJDeviceAuthManager ()
@property(nonatomic, strong) dispatch_queue_t authQueue;
@property(nonatomic, copy, nullable) NSString *cachedDeviceCredentialId;
@property(nonatomic, copy, nullable) NSString *cachedUploadToken;
@property(nonatomic, strong, nullable) NSDate *uploadTokenExpiry;
@property(nonatomic, copy, nullable) NSString *apiUrl;
@property(nonatomic, copy, nullable) NSString *projectPublicKey;
@property(nonatomic, copy, nullable) NSString *storedBundleId;
@property(nonatomic, copy, nullable) NSString *storedPlatform;
@property(nonatomic, copy, nullable) NSString *storedSdkVersion;
@property(nonatomic, assign) BOOL registrationInProgress;
@property(nonatomic, strong, nullable) NSMutableArray<RJDeviceTokenCompletionHandler> *pendingTokenCallbacks;
// Cooldown to prevent flood of failed registrations
@property(nonatomic, assign) NSTimeInterval lastFailedRegistrationTime;
@property(nonatomic, assign) NSInteger consecutiveFailures;
@end

// Cooldown constants
static const NSTimeInterval RJ_AUTH_COOLDOWN_BASE_SECONDS = 5.0;  // 5 second base cooldown
static const NSTimeInterval RJ_AUTH_COOLDOWN_MAX_SECONDS = 300.0;  // 5 minute max cooldown
static const NSInteger RJ_AUTH_MAX_CONSECUTIVE_FAILURES = 10;

@implementation RJDeviceAuthManager

+ (instancetype)sharedManager {
  static RJDeviceAuthManager *sharedInstance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    sharedInstance = [[self alloc] init];
  });
  return sharedInstance;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _authQueue = dispatch_queue_create("com.rejourney.deviceauth",
                                       DISPATCH_QUEUE_SERIAL);
    _pendingTokenCallbacks = [NSMutableArray array];
    _registrationInProgress = NO;
    [self loadStoredCredentials];
  }
  return self;
}

#pragma mark - Public Methods

- (void)registerDeviceWithProjectKey:(NSString *)projectPublicKey
                            bundleId:(NSString *)bundleId
                            platform:(NSString *)platform
                          sdkVersion:(NSString *)sdkVersion
                              apiUrl:(NSString *)apiUrl
                          completion:(RJDeviceAuthCompletionHandler)completion {

  
  self.apiUrl = apiUrl;
  self.projectPublicKey = projectPublicKey;
  self.storedBundleId = bundleId;
  self.storedPlatform = platform;
  self.storedSdkVersion = sdkVersion;

  RJLogDebug(@"configured apiUrl: '%@'", apiUrl);

  
  if (self.cachedDeviceCredentialId) {
    RJLogDebug(@"Device already registered with credential: %@",
               self.cachedDeviceCredentialId);
    if (completion) {
      completion(YES, self.cachedDeviceCredentialId, nil);
    }
    return;
  }

  dispatch_async(self.authQueue, ^{
    @autoreleasepool {
      
      SecKeyRef privateKey = [self getOrCreatePrivateKey];
      if (!privateKey) {
        NSError *error =
            [NSError errorWithDomain:@"RJDeviceAuth"
                                code:1001
                            userInfo:@{
                              NSLocalizedDescriptionKey :
                                  @"Failed to generate ECDSA keypair"
                            }];
        RJLogError(@"Failed to generate keypair");
        if (completion) {
          dispatch_async(dispatch_get_main_queue(), ^{
            completion(NO, nil, error);
          });
        }
        return;
      }

      
      SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
      if (!publicKey) {
        CFRelease(privateKey);
        NSError *error = [NSError
            errorWithDomain:@"RJDeviceAuth"
                       code:1002
                   userInfo:@{
                     NSLocalizedDescriptionKey : @"Failed to extract public key"
                   }];
        RJLogError(@"Failed to extract public key");
        if (completion) {
          dispatch_async(dispatch_get_main_queue(), ^{
            completion(NO, nil, error);
          });
        }
        return;
      }

      NSString *publicKeyPEM = [self exportPublicKeyToPEM:publicKey];
      CFRelease(publicKey);
      CFRelease(privateKey);

      if (!publicKeyPEM) {
        NSError *error = [NSError
            errorWithDomain:@"RJDeviceAuth"
                       code:1003
                   userInfo:@{
                     NSLocalizedDescriptionKey : @"Failed to export public key"
                   }];
        RJLogError(@"Failed to export public key to PEM");
        if (completion) {
          dispatch_async(dispatch_get_main_queue(), ^{
            completion(NO, nil, error);
          });
        }
        return;
      }

      
      [self registerWithBackend:projectPublicKey
                       bundleId:bundleId
                       platform:platform
                     sdkVersion:sdkVersion
                   publicKeyPEM:publicKeyPEM
                     completion:completion];
    }
  });
}

- (void)getUploadTokenWithCompletion:
    (RJDeviceTokenCompletionHandler)completion {
  
  if ([self hasValidUploadToken]) {
    NSTimeInterval remainingTime =
        [self.uploadTokenExpiry timeIntervalSinceNow];
    RJLogDebug(@"Using cached upload token (expires in %ld seconds)",
               (long)remainingTime);
    if (completion) {
      completion(YES, self.cachedUploadToken, (NSInteger)remainingTime, nil);
    }
    return;
  }

  
  dispatch_async(self.authQueue, ^{
    @autoreleasepool {
      if (!self.cachedDeviceCredentialId) {
        NSError *error = [NSError
            errorWithDomain:@"RJDeviceAuth"
                       code:2001
                   userInfo:@{
                     NSLocalizedDescriptionKey : @"Device not registered"
                   }];
        RJLogError(@"Cannot get upload token: device not registered");
        if (completion) {
          dispatch_async(dispatch_get_main_queue(), ^{
            completion(NO, nil, 0, error);
          });
        }
        return;
      }

      
      [self requestChallengeWithCompletion:^(BOOL success, NSString *challenge,
                                             NSString *nonce, NSError *error) {
        if (!success || !challenge || !nonce) {
          RJLogError(@"Failed to get challenge: %@", error);
          if (completion) {
            completion(NO, nil, 0, error);
          }
          return;
        }

        
        NSString *signature = [self signChallenge:challenge];
        if (!signature) {
          NSError *signError = [NSError
              errorWithDomain:@"RJDeviceAuth"
                         code:2002
                     userInfo:@{
                       NSLocalizedDescriptionKey : @"Failed to sign challenge"
                     }];
          RJLogError(@"Failed to sign challenge");
          if (completion) {
            completion(NO, nil, 0, signError);
          }
          return;
        }

        
        [self startSessionWithChallenge:challenge
                                  nonce:nonce
                              signature:signature
                             completion:completion];
      }];
    }
  });
}

- (nullable NSString *)deviceCredentialId {
  return self.cachedDeviceCredentialId;
}

- (nullable NSString *)currentUploadToken {
  if ([self hasValidUploadToken]) {
    return self.cachedUploadToken;
  }
  return nil;
}

- (BOOL)hasValidUploadToken {
  if (!self.cachedUploadToken || !self.uploadTokenExpiry) {
    return NO;
  }

  
  NSTimeInterval timeUntilExpiry =
      [self.uploadTokenExpiry timeIntervalSinceNow];
  return timeUntilExpiry > 60.0;
}

- (void)clearAllAuthData {
  [self deletePrivateKey];

  RJKeychainManager *keychain = [RJKeychainManager sharedManager];
  [keychain deleteValueForKey:kDeviceCredentialKey];
  [keychain deleteValueForKey:kUploadTokenKey];
  [keychain deleteValueForKey:kUploadTokenExpiryKey];

  self.cachedDeviceCredentialId = nil;
  self.cachedUploadToken = nil;
  self.uploadTokenExpiry = nil;

  RJLogDebug(@"Cleared all device auth data");
}

#pragma mark - ECDSA Keypair Management

- (nullable SecKeyRef)getOrCreatePrivateKey {
  return [self getOrCreatePrivateKeyWithRetry:YES];
}

- (nullable SecKeyRef)getOrCreatePrivateKeyWithRetry:(BOOL)shouldRetryOnFailure {
  
  SecKeyRef privateKey = [self loadPrivateKeyFromKeychain];
  if (privateKey) {
    
    SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
    if (publicKey) {
      CFRelease(publicKey);
      RJLogDebug(@"Loaded existing ECDSA private key");
      return privateKey;
    } else {
      
      RJLogWarning(@"Existing private key is corrupted, deleting and regenerating");
      CFRelease(privateKey);
      [self deletePrivateKey];
      [self clearAllAuthData];
    }
  }

  
  RJLogDebug(@"Generating new ECDSA P-256 keypair");

  NSDictionary *attributes = @{
    (__bridge id)kSecAttrKeyType : (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
    (__bridge id)kSecAttrKeySizeInBits : @256,
    (__bridge id)kSecPrivateKeyAttrs : @{
      (__bridge id)kSecAttrIsPermanent : @YES,
      (__bridge id)kSecAttrApplicationTag :
          [kKeychainKeyTag dataUsingEncoding:NSUTF8StringEncoding],
      (__bridge id)kSecAttrAccessible :
          (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    }
  };

  CFErrorRef error = NULL;
  privateKey =
      SecKeyCreateRandomKey((__bridge CFDictionaryRef)attributes, &error);

  if (error) {
    CFStringRef errorDesc = CFErrorCopyDescription(error);
    RJLogError(@"Failed to generate ECDSA key: %@",
               (__bridge NSString *)errorDesc);
    if (errorDesc)
      CFRelease(errorDesc);
    CFRelease(error);
    
    
    
    if (shouldRetryOnFailure) {
      RJLogDebug(@"Attempting recovery: deleting existing key and retrying generation");
      [self deletePrivateKey];
      return [self getOrCreatePrivateKeyWithRetry:NO];
    }
    
    return NULL;
  }

  if (!privateKey) {
    RJLogError(@"SecKeyCreateRandomKey returned NULL");
    return NULL;
  }

  RJLogDebug(@"Successfully generated ECDSA P-256 keypair");
  return privateKey;
}

- (nullable SecKeyRef)loadPrivateKeyFromKeychain {
  NSDictionary *query = @{
    (__bridge id)kSecClass : (__bridge id)kSecClassKey,
    (__bridge id)kSecAttrApplicationTag :
        [kKeychainKeyTag dataUsingEncoding:NSUTF8StringEncoding],
    (__bridge id)kSecAttrKeyType : (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
    (__bridge id)kSecReturnRef : @YES
  };

  SecKeyRef privateKey = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query,
                                        (CFTypeRef *)&privateKey);

  if (status == errSecSuccess && privateKey) {
    return privateKey;
  }

  return NULL;
}

- (void)deletePrivateKey {
  NSDictionary *query = @{
    (__bridge id)kSecClass : (__bridge id)kSecClassKey,
    (__bridge id)kSecAttrApplicationTag :
        [kKeychainKeyTag dataUsingEncoding:NSUTF8StringEncoding],
    (__bridge id)kSecAttrKeyType : (__bridge id)kSecAttrKeyTypeECSECPrimeRandom
  };

  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
  if (status == errSecSuccess) {
    RJLogDebug(@"Deleted private key from Keychain");
  }
}

- (nullable NSString *)exportPublicKeyToPEM:(SecKeyRef)publicKey {
  CFErrorRef error = NULL;
  CFDataRef publicKeyDataRef =
      SecKeyCopyExternalRepresentation(publicKey, &error);

  if (error) {
    CFStringRef errorDesc = CFErrorCopyDescription(error);
    RJLogError(@"Failed to export public key: %@",
               (__bridge NSString *)errorDesc);
    if (errorDesc)
      CFRelease(errorDesc);
    CFRelease(error);
    return nil;
  }

  if (!publicKeyDataRef) {
    RJLogError(@"Public key data is nil");
    return nil;
  }

  NSData *publicKeyData = (__bridge NSData *)publicKeyDataRef;

  
  
  NSString *base64 = [publicKeyData
      base64EncodedStringWithOptions:NSDataBase64Encoding64CharacterLineLength];

  
  NSString *pem = [NSString
      stringWithFormat:
          @"-----BEGIN PUBLIC KEY-----\n%@\n-----END PUBLIC KEY-----", base64];

  CFRelease(publicKeyDataRef);

  return pem;
}

- (nullable NSString *)signChallenge:(NSString *)challenge {
  
  SecKeyRef privateKey = [self loadPrivateKeyFromKeychain];
  if (!privateKey) {
    RJLogError(@"Private key not found");
    return nil;
  }

  
  NSData *challengeData = [[NSData alloc] initWithBase64EncodedString:challenge
                                                              options:0];
  if (!challengeData) {
    CFRelease(privateKey);
    RJLogError(@"Invalid challenge base64");
    return nil;
  }

  
  CFErrorRef error = NULL;
  CFDataRef signatureRef = SecKeyCreateSignature(
      privateKey, kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
      (__bridge CFDataRef)challengeData, &error);

  CFRelease(privateKey);

  if (error) {
    CFStringRef errorDesc = CFErrorCopyDescription(error);
    RJLogError(@"Failed to sign challenge: %@", (__bridge NSString *)errorDesc);
    if (errorDesc)
      CFRelease(errorDesc);
    CFRelease(error);
    return nil;
  }

  if (!signatureRef) {
    RJLogError(@"Signature is nil");
    return nil;
  }

  NSData *signature = (__bridge NSData *)signatureRef;

  
  NSString *base64Sig = [signature base64EncodedStringWithOptions:0];

  CFRelease(signatureRef);

  return base64Sig;
}

#pragma mark - Backend Communication

- (void)registerWithBackend:(NSString *)projectPublicKey
                   bundleId:(NSString *)bundleId
                   platform:(NSString *)platform
                 sdkVersion:(NSString *)sdkVersion
               publicKeyPEM:(NSString *)publicKeyPEM
                 completion:(RJDeviceAuthCompletionHandler)completion {

  NSString *urlString =
      [NSString stringWithFormat:@"%@/api/devices/register", self.apiUrl];
  RJLogDebug(@"Register URL: %@", urlString);
  NSURL *url = [NSURL URLWithString:urlString];

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"POST";
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];

  NSDictionary *body = @{
    @"projectPublicKey" : projectPublicKey,
    @"bundleId" : bundleId,
    @"platform" : platform,
    @"sdkVersion" : sdkVersion,
    @"devicePublicKey" : publicKeyPEM
  };

  NSError *jsonError;
  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body
                                                     options:0
                                                       error:&jsonError];

  if (jsonError) {
    RJLogError(@"Failed to serialize registration request: %@", jsonError);
    if (completion) {
      dispatch_async(dispatch_get_main_queue(), ^{
        completion(NO, nil, jsonError);
      });
    }
    return;
  }

  RJLogDebug(@"Registering device with backend...");

  NSURLSessionDataTask *task = [[NSURLSession sharedSession]
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response,
                            NSError *error) {
          if (error) {
            RJLogError(@"Registration request failed: %@", error);
            if (completion) {
              dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, nil, error);
              });
            }
            return;
          }

          NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
          if (httpResponse.statusCode != 200) {
            NSString *errorMsg = [NSString
                stringWithFormat:@"Registration failed with status %ld",
                                 (long)httpResponse.statusCode];
            NSError *httpError = [NSError
                errorWithDomain:@"RJDeviceAuth"
                           code:httpResponse.statusCode
                       userInfo:@{NSLocalizedDescriptionKey : errorMsg}];
            RJLogError(@"%@", errorMsg);
            if (completion) {
              dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, nil, httpError);
              });
            }
            return;
          }

          NSError *parseError;
          NSDictionary *json =
              [NSJSONSerialization JSONObjectWithData:data
                                              options:0
                                                error:&parseError];

          if (parseError || !json[@"deviceCredentialId"]) {
            RJLogError(@"Failed to parse registration response: %@",
                       parseError);
            if (completion) {
              dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, nil, parseError);
              });
            }
            return;
          }

          NSString *credentialId = json[@"deviceCredentialId"];
          [self saveDeviceCredentialId:credentialId];

          RJLogDebug(@"Device registered: %@", credentialId);

          if (completion) {
            dispatch_async(dispatch_get_main_queue(), ^{
              completion(YES, credentialId, nil);
            });
          }
        }];

  [task resume];
}

- (void)requestChallengeWithCompletion:
    (void (^)(BOOL success, NSString *_Nullable challenge,
              NSString *_Nullable nonce, NSError *_Nullable error))completion {

  NSString *urlString = [NSString
      stringWithFormat:@"%@/api/devices/challenge", self.apiUrl];
  RJLogDebug(@"Challenge URL: %@", urlString);
  NSURL *url = [NSURL URLWithString:urlString];

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"POST";
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];

  NSDictionary *body = @{@"deviceCredentialId" : self.cachedDeviceCredentialId};

  NSError *jsonError;
  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body
                                                     options:0
                                                       error:&jsonError];

  if (jsonError) {
    RJLogError(@"Failed to serialize challenge request: %@", jsonError);
    if (completion) {
      completion(NO, nil, nil, jsonError);
    }
    return;
  }

  RJLogDebug(@"Requesting challenge from backend...");

  NSURLSessionDataTask *task = [[NSURLSession sharedSession]
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response,
                            NSError *error) {
          if (error) {
            RJLogError(@"Challenge request failed: %@", error);
            if (completion) {
              completion(NO, nil, nil, error);
            }
            return;
          }

          NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
          if (httpResponse.statusCode != 200) {
            NSString *errorMsg = [NSString
                stringWithFormat:@"Challenge request failed with status %ld",
                                 (long)httpResponse.statusCode];

            
            if (data) {
              NSString *body =
                  [[NSString alloc] initWithData:data
                                        encoding:NSUTF8StringEncoding];
              RJLogError(@"Error response body: %@", body);
            }

            
            
            if (httpResponse.statusCode == 404 || httpResponse.statusCode == 403) {
              RJLogDebug(@"Device credential rejected by backend (%ld) - "
                         @"clearing local credentials",
                         (long)httpResponse.statusCode);
              [self clearAllAuthData];
            }

            NSError *httpError = [NSError
                errorWithDomain:@"RJDeviceAuth"
                           code:httpResponse.statusCode
                       userInfo:@{NSLocalizedDescriptionKey : errorMsg}];
            RJLogError(@"%@", errorMsg);
            if (completion) {
              completion(NO, nil, nil, httpError);
            }
            return;
          }

          NSError *parseError;
          NSDictionary *json =
              [NSJSONSerialization JSONObjectWithData:data
                                              options:0
                                                error:&parseError];

          if (parseError || !json[@"challenge"] || !json[@"nonce"]) {
            RJLogError(@"Failed to parse challenge response: %@", parseError);
            if (completion) {
              completion(NO, nil, nil, parseError);
            }
            return;
          }

          NSString *challenge = json[@"challenge"];
          NSString *nonce = json[@"nonce"];

          RJLogDebug(@"Received challenge from backend");

          if (completion) {
            completion(YES, challenge, nonce, nil);
          }
        }];

  [task resume];
}

- (void)startSessionWithChallenge:(NSString *)challenge
                            nonce:(NSString *)nonce
                        signature:(NSString *)signature
                       completion:(RJDeviceTokenCompletionHandler)completion {

  NSString *urlString = [NSString
      stringWithFormat:@"%@/api/devices/start-session", self.apiUrl];
  RJLogDebug(@"Start Session URL: %@", urlString);
  NSURL *url = [NSURL URLWithString:urlString];

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.HTTPMethod = @"POST";
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];

  NSDictionary *body = @{
    @"deviceCredentialId" : self.cachedDeviceCredentialId,
    @"challenge" : challenge,
    @"signature" : signature,
    @"nonce" : nonce
  };

  NSError *jsonError;
  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body
                                                     options:0
                                                       error:&jsonError];

  if (jsonError) {
    RJLogError(@"Failed to serialize start-session request: %@", jsonError);
    if (completion) {
      dispatch_async(dispatch_get_main_queue(), ^{
        completion(NO, nil, 0, jsonError);
      });
    }
    return;
  }

  RJLogDebug(@"Starting session with signed challenge...");

  NSURLSessionDataTask *task = [[NSURLSession sharedSession]
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response,
                            NSError *error) {
          if (error) {
            RJLogError(@"Start-session request failed: %@", error);
            if (completion) {
              dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, nil, 0, error);
              });
            }
            return;
          }

          NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
          if (httpResponse.statusCode != 200) {
            NSString *errorMsg = [NSString
                stringWithFormat:@"Start-session failed with status %ld",
                                 (long)httpResponse.statusCode];
            NSError *httpError = [NSError
                errorWithDomain:@"RJDeviceAuth"
                           code:httpResponse.statusCode
                       userInfo:@{NSLocalizedDescriptionKey : errorMsg}];
            RJLogError(@"%@", errorMsg);
            if (completion) {
              dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, nil, 0, httpError);
              });
            }
            return;
          }

          NSError *parseError;
          NSDictionary *json =
              [NSJSONSerialization JSONObjectWithData:data
                                              options:0
                                                error:&parseError];

          if (parseError || !json[@"uploadToken"]) {
            RJLogError(@"Failed to parse start-session response: %@",
                       parseError);
            if (completion) {
              dispatch_async(dispatch_get_main_queue(), ^{
                completion(NO, nil, 0, parseError);
              });
            }
            return;
          }

          NSString *uploadToken = json[@"uploadToken"];
          NSInteger expiresIn = [json[@"expiresIn"] integerValue];

          [self saveUploadToken:uploadToken expiresIn:expiresIn];

          RJLogDebug(@"Got upload token (expires in %ld seconds)",
                     (long)expiresIn);

          if (completion) {
            dispatch_async(dispatch_get_main_queue(), ^{
              completion(YES, uploadToken, expiresIn, nil);
            });
          }
        }];

  [task resume];
}

#pragma mark - Storage

- (void)loadStoredCredentials {
  RJKeychainManager *keychain = [RJKeychainManager sharedManager];

  self.cachedDeviceCredentialId = [keychain stringForKey:kDeviceCredentialKey];
  self.cachedUploadToken = [keychain stringForKey:kUploadTokenKey];

  NSString *expiryString = [keychain stringForKey:kUploadTokenExpiryKey];
  if (expiryString) {
    self.uploadTokenExpiry =
        [NSDate dateWithTimeIntervalSince1970:[expiryString doubleValue]];
  }

  if (self.cachedDeviceCredentialId) {
    RJLogDebug(@"Loaded stored device credential: %@",
               self.cachedDeviceCredentialId);
  }
}

- (void)saveDeviceCredentialId:(NSString *)credentialId {
  self.cachedDeviceCredentialId = credentialId;
  [[RJKeychainManager sharedManager] setString:credentialId
                                        forKey:kDeviceCredentialKey];
}

- (void)saveUploadToken:(NSString *)token expiresIn:(NSInteger)expiresIn {
  self.cachedUploadToken = token;
  self.uploadTokenExpiry = [NSDate dateWithTimeIntervalSinceNow:expiresIn];

  RJKeychainManager *keychain = [RJKeychainManager sharedManager];
  [keychain setString:token forKey:kUploadTokenKey];
  [keychain setString:[@([self.uploadTokenExpiry timeIntervalSince1970]) stringValue]
               forKey:kUploadTokenExpiryKey];
}

#pragma mark - Auto Registration

- (BOOL)canAutoRegister {
  return self.projectPublicKey.length > 0 && 
         self.storedBundleId.length > 0 && 
         self.apiUrl.length > 0;
}

- (BOOL)isDeviceRegistered {
  return self.cachedDeviceCredentialId.length > 0;
}

- (void)getUploadTokenWithAutoRegisterCompletion:(RJDeviceTokenCompletionHandler)completion {
  
  if ([self hasValidUploadToken]) {
    NSTimeInterval remainingTime = [self.uploadTokenExpiry timeIntervalSinceNow];
    RJLogDebug(@"Using cached upload token (expires in %ld seconds)", (long)remainingTime);
    if (completion) {
      completion(YES, self.cachedUploadToken, (NSInteger)remainingTime, nil);
    }
    return;
  }

  
  if (self.cachedDeviceCredentialId) {
    [self getUploadTokenWithCompletion:completion];
    return;
  }

  
  if (![self canAutoRegister]) {
    NSError *error = [NSError
        errorWithDomain:@"RJDeviceAuth"
                   code:2003
               userInfo:@{
                 NSLocalizedDescriptionKey : @"Device not registered and auto-registration not configured"
               }];
    RJLogError(@"Cannot auto-register: missing registration parameters");
    if (completion) {
      dispatch_async(dispatch_get_main_queue(), ^{
        completion(NO, nil, 0, error);
      });
    }
    return;
  }
  
  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  if (self.consecutiveFailures > 0 && self.lastFailedRegistrationTime > 0) {
    NSTimeInterval cooldown = MIN(
      RJ_AUTH_COOLDOWN_BASE_SECONDS * pow(2, self.consecutiveFailures - 1),
      RJ_AUTH_COOLDOWN_MAX_SECONDS
    );
    NSTimeInterval timeSinceLastFailure = now - self.lastFailedRegistrationTime;
    
    if (timeSinceLastFailure < cooldown) {
      NSTimeInterval remainingCooldown = cooldown - timeSinceLastFailure;
      RJLogDebug(@"Auto-registration in cooldown (%.1fs remaining after %ld failures)", 
                 remainingCooldown, (long)self.consecutiveFailures);
      
      NSError *cooldownError = [NSError
          errorWithDomain:@"RJDeviceAuth"
                     code:429
                 userInfo:@{NSLocalizedDescriptionKey : 
                   [NSString stringWithFormat:@"Rate limited - retry in %.0fs", remainingCooldown]}];
      if (completion) {
        dispatch_async(dispatch_get_main_queue(), ^{
          completion(NO, nil, 0, cooldownError);
        });
      }
      return;
    }
  }

  
  @synchronized(self.pendingTokenCallbacks) {
    if (completion) {
      [self.pendingTokenCallbacks addObject:[completion copy]];
    }

    
    if (self.registrationInProgress) {
      RJLogDebug(@"Auto-registration already in progress, callback queued");
      return;
    }

    self.registrationInProgress = YES;
  }

  RJLogDebug(@"Device not registered - starting automatic re-registration...");

  __weak __typeof__(self) weakSelf = self;
  [self registerDeviceWithProjectKey:self.projectPublicKey
                            bundleId:self.storedBundleId
                            platform:self.storedPlatform ?: @"ios"
                          sdkVersion:self.storedSdkVersion ?: @"1.0.0"
                              apiUrl:self.apiUrl
                          completion:^(BOOL success, NSString *credId, NSError *error) {
    __strong __typeof__(weakSelf) strongSelf = weakSelf;
    if (!strongSelf) return;

    if (!success) {
      RJLogError(@"Auto-registration failed: %@", error);
      // Track consecutive failures for exponential backoff
      strongSelf.consecutiveFailures++;
      strongSelf.lastFailedRegistrationTime = [[NSDate date] timeIntervalSince1970];
      
      if (strongSelf.consecutiveFailures >= RJ_AUTH_MAX_CONSECUTIVE_FAILURES) {
        RJLogError(@"Auto-registration failed %ld times - backing off significantly", 
                   (long)strongSelf.consecutiveFailures);
      }
      
      [strongSelf notifyPendingCallbacksWithSuccess:NO token:nil expiresIn:0 error:error];
      return;
    }

    // Success! Reset failure tracking
    strongSelf.consecutiveFailures = 0;
    strongSelf.lastFailedRegistrationTime = 0;
    
    RJLogDebug(@"Auto-registration successful (credential: %@), fetching upload token...", credId);

    
    [strongSelf getUploadTokenWithCompletion:^(BOOL tokenSuccess, NSString *token, 
                                                NSInteger expiresIn, NSError *tokenError) {
      [strongSelf notifyPendingCallbacksWithSuccess:tokenSuccess 
                                              token:token 
                                          expiresIn:expiresIn 
                                              error:tokenError];
    }];
  }];
}

- (void)notifyPendingCallbacksWithSuccess:(BOOL)success 
                                    token:(NSString *)token 
                                expiresIn:(NSInteger)expiresIn 
                                    error:(NSError *)error {
  NSArray<RJDeviceTokenCompletionHandler> *callbacks;
  
  @synchronized(self.pendingTokenCallbacks) {
    self.registrationInProgress = NO;
    callbacks = [self.pendingTokenCallbacks copy];
    [self.pendingTokenCallbacks removeAllObjects];
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    for (RJDeviceTokenCompletionHandler callback in callbacks) {
      callback(success, token, expiresIn, error);
    }
  });
}

@end
