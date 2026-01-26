/**
 * Validation utilities for app identifiers
 */

// Android package name format: com.example.app
// - Must start with a letter
// - Can contain letters, numbers, underscores
// - Segments separated by dots
// - At least 2 segments required
// - No hyphens allowed (Java package naming convention)
export const ANDROID_PACKAGE_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

// iOS bundle ID format: com.example.app
// - Similar to Android but allows hyphens
// - Must start with a letter
// - Can contain letters, numbers, underscores, hyphens
// - Segments separated by dots
// - At least 2 segments required
export const IOS_BUNDLE_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z][a-zA-Z0-9_-]*)+$/;

export function isValidAndroidPackage(packageName: string): boolean {
    return ANDROID_PACKAGE_REGEX.test(packageName);
}

export function isValidIosBundleId(bundleId: string): boolean {
    return IOS_BUNDLE_REGEX.test(bundleId);
}

export function getAndroidPackageError(packageName: string): string | null {
    if (!packageName) return null;

    if (packageName.includes('-')) {
        return 'Hyphens not allowed in Android package names. Use underscores instead.';
    }

    if (!packageName.includes('.')) {
        return 'Must include at least one dot (e.g., com.example.app)';
    }

    if (/^\d/.test(packageName) || packageName.split('.').some(seg => /^\d/.test(seg))) {
        return 'Each segment must start with a letter, not a number.';
    }

    if (!ANDROID_PACKAGE_REGEX.test(packageName)) {
        return 'Invalid format. Example: com.example.app';
    }

    return null;
}

export function getIosBundleIdError(bundleId: string): string | null {
    if (!bundleId) return null;

    if (!bundleId.includes('.')) {
        return 'Must include at least one dot (e.g., com.example.app)';
    }

    if (/^\d/.test(bundleId) || bundleId.split('.').some(seg => /^\d/.test(seg))) {
        return 'Each segment must start with a letter, not a number.';
    }

    if (!IOS_BUNDLE_REGEX.test(bundleId)) {
        return 'Invalid format. Example: com.example.app';
    }

    return null;
}
