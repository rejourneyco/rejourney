/**
 * Utility function to merge class names
 * Filters out falsy values and joins with spaces
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
    return classes.filter(Boolean).join(' ');
}
