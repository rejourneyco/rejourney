/**
 * App Identifier Validation
 *
 * Validates iOS bundle identifiers and Android package names.
 * Accepts input that matches EITHER format.
 *
 * Combined UX rules:
 *   • Length 3-155
 *   • Must contain at least one period (.)
 *   • Allowed chars: A-Z a-z 0-9 . - _
 *   • Cannot start or end with .
 *   • No consecutive dots (..)
 */

const IOS_BUNDLE_REGEX = /^[A-Za-z0-9.\-]{1,155}$/;
const ANDROID_PACKAGE_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** Returns an error message if the identifier is invalid, or null if valid. */
function validateAppIdentifier(value: string): string | null {
    if (!value) return null; // Empty is OK (field is optional)
    if (value.length < 3) return 'Must be at least 3 characters';
    if (value.length > 155) return 'Cannot exceed 155 characters';
    if (!value.includes('.')) return 'Must contain at least one period (e.g. com.example.app)';
    if (value.startsWith('.') || value.endsWith('.')) return 'Cannot start or end with a period';
    if (value.includes('..')) return 'Cannot contain consecutive periods';

    const isValidIos = IOS_BUNDLE_REGEX.test(value);
    const isValidAndroid = ANDROID_PACKAGE_REGEX.test(value);

    if (!isValidIos && !isValidAndroid) {
        return 'Only letters, numbers, periods, hyphens, and underscores are allowed';
    }
    return null;
}

/** Validate an iOS bundle ID. Returns error string or null. */
export function getIosBundleIdError(value: string): string | null {
    return validateAppIdentifier(value);
}

/** Validate an Android package name. Returns error string or null. */
export function getAndroidPackageError(value: string): string | null {
    return validateAppIdentifier(value);
}

/** Validate any app identifier (iOS or Android). Returns error string or null. */
export function getAppIdentifierError(value: string): string | null {
    return validateAppIdentifier(value);
}
