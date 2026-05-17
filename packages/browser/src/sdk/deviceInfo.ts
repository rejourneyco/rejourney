import { SDK_VERSION } from './constants.js';
import type { WebDeviceInfo } from './types.js';

type NavigatorWithClientHints = Navigator & {
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    platform?: string;
    mobile?: boolean;
    getHighEntropyValues?: (hints: string[]) => Promise<UserAgentHighEntropyValues>;
  };
  connection?: {
    effectiveType?: string;
    type?: string;
    saveData?: boolean;
  };
};

type UserAgentHighEntropyValues = {
  architecture?: string;
  brands?: Array<{ brand: string; version: string }>;
  fullVersionList?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  model?: string;
  platform?: string;
  platformVersion?: string;
  uaFullVersion?: string;
};

export type BrowserInfo = {
  name: string;
  version?: string;
};

export type OsInfo = {
  name: string;
  version?: string;
};

function normalizeVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const normalized = version.replace(/_/g, '.').replace(/[^\d.]/g, '').replace(/\.+/g, '.').replace(/^\./, '').replace(/\.$/, '');
  return normalized || undefined;
}

function firstVersionMatch(userAgent: string, pattern: RegExp): string | undefined {
  return normalizeVersion(userAgent.match(pattern)?.[1]);
}

function cleanBrandName(brand: string): string {
  return brand
    .replace(/^Google Chrome$/i, 'Chrome')
    .replace(/^HeadlessChrome$/i, 'Chrome')
    .replace(/^Microsoft Edge$/i, 'Edge')
    .replace(/^Chromium$/i, 'Chrome')
    .trim();
}

function browserFromClientHints(nav: NavigatorWithClientHints | null, highEntropy?: UserAgentHighEntropyValues | null): BrowserInfo | null {
  const brands = highEntropy?.fullVersionList || highEntropy?.brands || nav?.userAgentData?.brands;
  if (!brands?.length) return null;

  const preferred = brands.find((brand) => /edge|chrome|chromium|firefox|safari|opera|brave/i.test(brand.brand))
    ?? brands.find((brand) => !/not.?a.?brand/i.test(brand.brand));
  if (!preferred) return null;

  const name = cleanBrandName(preferred.brand);
  return name ? { name, version: normalizeVersion(preferred.version) } : null;
}

export function detectBrowserInfo(
  userAgent: string,
  nav: NavigatorWithClientHints | null = null,
  highEntropy?: UserAgentHighEntropyValues | null,
): BrowserInfo {
  const ua = userAgent || '';
  const hinted = browserFromClientHints(nav, highEntropy);
  if (hinted?.name && hinted.version && (!/Chrome\//.test(ua) || hinted.version.split('.').length > 1)) {
    return hinted;
  }

  const directMatchers: Array<[RegExp, string]> = [
    [/EdgA?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/FxiOS\/([\d.]+)/, 'Firefox'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/HeadlessChrome\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
  ];

  for (const [pattern, name] of directMatchers) {
    const version = firstVersionMatch(ua, pattern);
    if (version) return { name, version };
  }

  const safariVersion = firstVersionMatch(ua, /Version\/([\d.]+).*Safari\//);
  if (safariVersion || /Safari\//.test(ua)) {
    return { name: 'Safari', version: safariVersion };
  }

  return hinted ?? { name: 'Browser' };
}

export function detectOsInfo(
  userAgent: string,
  nav: NavigatorWithClientHints | null = null,
  highEntropy?: UserAgentHighEntropyValues | null,
): OsInfo {
  const ua = userAgent || '';
  const platformHint = highEntropy?.platform || nav?.userAgentData?.platform || '';
  const platformVersionHint = normalizeVersion(highEntropy?.platformVersion);

  const chromeOsVersion = firstVersionMatch(ua, /CrOS [^ ]+ ([\d.]+)/);
  if (chromeOsVersion || /CrOS/i.test(ua) || /Chrome OS|ChromeOS/i.test(platformHint)) {
    return { name: 'ChromeOS', version: platformVersionHint || chromeOsVersion };
  }

  const androidVersion = firstVersionMatch(ua, /Android ([\d.]+)/);
  if (androidVersion || /Android/i.test(platformHint)) {
    return { name: 'Android', version: platformVersionHint || androidVersion };
  }

  const iosVersion = firstVersionMatch(ua, /(?:iPhone|iPad|iPod).*OS ([\d_]+)/);
  if (iosVersion || /iPhone|iPad|iPod/i.test(ua) || /iOS/i.test(platformHint)) {
    return { name: /iPad/i.test(ua) ? 'iPadOS' : 'iOS', version: platformVersionHint || iosVersion };
  }

  const macVersion = firstVersionMatch(ua, /Mac OS X ([\d_]+)/);
  if (macVersion || /Macintosh|Mac OS/i.test(ua) || /macOS/i.test(platformHint)) {
    return { name: 'macOS', version: platformVersionHint || macVersion };
  }

  const windowsNtVersion = firstVersionMatch(ua, /Windows NT ([\d.]+)/);
  if (windowsNtVersion || /Windows/i.test(platformHint)) {
    const versionByNt: Record<string, string> = {
      '10.0': '10+',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7',
    };
    return { name: 'Windows', version: windowsNtVersion ? versionByNt[windowsNtVersion] ?? windowsNtVersion : undefined };
  }

  if (/Linux/i.test(ua) || /Linux/i.test(platformHint)) {
    return { name: 'Linux' };
  }

  return { name: 'Unknown OS' };
}

async function getHighEntropyValues(nav: NavigatorWithClientHints | null): Promise<UserAgentHighEntropyValues | null> {
  const userAgentData = nav?.userAgentData;
  const getValues = userAgentData?.getHighEntropyValues;
  if (typeof getValues !== 'function') return null;
  try {
    return await getValues.call(userAgentData, [
      'architecture',
      'model',
      'platform',
      'platformVersion',
      'uaFullVersion',
      'fullVersionList',
    ]);
  } catch {
    return null;
  }
}

function formatNameWithVersion(name: string, version?: string): string {
  return version ? `${name} ${version}` : name;
}

function getScreenWidth(): number {
  return typeof window !== 'undefined' ? window.screen.width : 0;
}

function getScreenHeight(): number {
  return typeof window !== 'undefined' ? window.screen.height : 0;
}

function getPixelRatio(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
}

function getTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function collectWebDeviceInfo(
  visitorId: string,
  nav: Navigator | null,
  highEntropy?: UserAgentHighEntropyValues | null,
): WebDeviceInfo {
  const navigatorInfo = nav as NavigatorWithClientHints | null;
  const userAgent = navigatorInfo?.userAgent || '';
  const browser = detectBrowserInfo(userAgent, navigatorInfo, highEntropy);
  const os = detectOsInfo(userAgent, navigatorInfo, highEntropy);
  const effectiveConnectionType = navigatorInfo?.connection?.effectiveType;

  return {
    platform: 'web',
    os: os.name,
    osVersion: os.version,
    model: `${browser.name} on ${os.name}`,
    screenWidth: getScreenWidth(),
    screenHeight: getScreenHeight(),
    pixelRatio: getPixelRatio(),
    userAgent,
    language: navigatorInfo?.language,
    timezone: getTimezone(),
    deviceId: visitorId,
    sdkVersion: SDK_VERSION,
    appVersion: SDK_VERSION,
    browser: browser.name,
    browserVersion: browser.version,
    networkType: effectiveConnectionType ? `effective-${effectiveConnectionType}` : navigatorInfo?.connection?.type,
    effectiveConnectionType,
    connectionSaveData: navigatorInfo?.connection?.saveData,
  };
}

export async function collectWebDeviceInfoWithHints(visitorId: string, nav: Navigator | null): Promise<WebDeviceInfo> {
  const navigatorInfo = nav as NavigatorWithClientHints | null;
  return collectWebDeviceInfo(visitorId, nav, await getHighEntropyValues(navigatorInfo));
}

export function formatBrowserInfoLabel(info: BrowserInfo): string {
  return formatNameWithVersion(info.name, info.version);
}

export function formatOsInfoLabel(info: OsInfo): string {
  return formatNameWithVersion(info.name, info.version);
}
