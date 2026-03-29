export const SELECTED_TEAM_COOKIE = 'rj_selected_team_id';
export const SELECTED_PROJECT_COOKIE = 'rj_selected_project_id';

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

export function writeSelectionCookie(name: string, value: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`;
}

export function clearSelectionCookie(name: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function readCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    const separatorIndex = trimmedPart.indexOf('=');
    if (separatorIndex === -1) continue;

    const cookieName = trimmedPart.slice(0, separatorIndex).trim();
    if (cookieName !== name) continue;

    const rawValue = trimmedPart.slice(separatorIndex + 1);
    if (!rawValue) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}
