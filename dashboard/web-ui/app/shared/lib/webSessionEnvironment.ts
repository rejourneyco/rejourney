type BrowserInfo = {
  name: string;
  version?: string;
};

type OsInfo = {
  name: string;
  version?: string;
};

export type WebSessionEnvironment = {
  browserLabel: string;
  browserTitle: string;
  osLabel: string;
  osTitle: string;
  sdkVersionLabel: string | null;
  networkLabel: string;
  networkTitle: string;
  rawNetworkType: string | null;
};

const UNKNOWNISH = new Set(['', 'unknown', 'vunknown', '?.?.?', 'unknown device', 'null', 'undefined', '-', '—']);

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized || UNKNOWNISH.has(normalized.toLowerCase())) return null;
  return normalized;
}

function isBrowserPlaceholder(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || UNKNOWNISH.has(normalized) || normalized === 'browser' || normalized === 'web';
}

function readNestedString(session: any, paths: string[][]): string | null {
  for (const path of paths) {
    let cursor = session;
    for (const key of path) {
      cursor = cursor?.[key];
    }
    const value = cleanString(cursor);
    if (value) return value;
  }
  return null;
}

function normalizeVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const normalized = version.replace(/_/g, '.').replace(/[^\d.]/g, '').replace(/\.+/g, '.').replace(/^\./, '').replace(/\.$/, '');
  return normalized || undefined;
}

function majorVersion(version: string | undefined): string | undefined {
  const normalized = normalizeVersion(version);
  return normalized?.split('.')[0] || undefined;
}

function firstVersionMatch(userAgent: string, pattern: RegExp): string | undefined {
  return normalizeVersion(userAgent.match(pattern)?.[1]);
}

export function parseBrowserFromUserAgent(userAgent: string | null | undefined): BrowserInfo | null {
  const ua = userAgent || '';
  const directMatchers: Array<[RegExp, string]> = [
    [/EdgA?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/FxiOS\/([\d.]+)/, 'Firefox'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
  ];

  for (const [pattern, name] of directMatchers) {
    const version = firstVersionMatch(ua, pattern);
    if (version) return { name, version };
  }

  const safariVersion = firstVersionMatch(ua, /Version\/([\d.]+).*Safari\//);
  if (safariVersion || /Safari\//.test(ua)) return { name: 'Safari', version: safariVersion };
  return null;
}

export function parseOsFromUserAgent(userAgent: string | null | undefined): OsInfo | null {
  const ua = userAgent || '';
  const chromeOsVersion = firstVersionMatch(ua, /CrOS [^ ]+ ([\d.]+)/);
  if (chromeOsVersion || /CrOS/i.test(ua)) return { name: 'ChromeOS', version: chromeOsVersion };

  const androidVersion = firstVersionMatch(ua, /Android ([\d.]+)/);
  if (androidVersion) return { name: 'Android', version: androidVersion };

  const iosVersion = firstVersionMatch(ua, /(?:iPhone|iPad|iPod).*OS ([\d_]+)/);
  if (iosVersion || /iPhone|iPad|iPod/i.test(ua)) return { name: /iPad/i.test(ua) ? 'iPadOS' : 'iOS', version: iosVersion };

  const macVersion = firstVersionMatch(ua, /Mac OS X ([\d_]+)/);
  if (macVersion || /Macintosh|Mac OS/i.test(ua)) return { name: 'macOS', version: macVersion };

  const windowsNtVersion = firstVersionMatch(ua, /Windows NT ([\d.]+)/);
  if (windowsNtVersion) {
    const versionByNt: Record<string, string> = {
      '10.0': '10+',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7',
    };
    return { name: 'Windows', version: versionByNt[windowsNtVersion] ?? windowsNtVersion };
  }

  if (/Linux/i.test(ua)) return { name: 'Linux' };
  return null;
}

function readUserAgent(session: any): string | null {
  return readNestedString(session, [
    ['userAgent'],
    ['deviceInfo', 'userAgent'],
    ['metadata', 'userAgent'],
    ['metadata', 'browserUserAgent'],
  ]);
}

function splitBrowserAndOsFromModel(model: string | null): { browser?: string; os?: string } {
  if (!model || isBrowserPlaceholder(model)) return {};
  const onMatch = model.match(/^\s*(.+?)\s+(?:on|\/)\s+(.+?)\s*$/i);
  if (!onMatch) return { browser: model };
  return {
    browser: cleanString(onMatch[1]) ?? undefined,
    os: cleanString(onMatch[2]) ?? undefined,
  };
}

function formatBrowserLabel(name: string | null, version: string | null): string {
  const browser = cleanString(name) || 'Browser';
  const major = majorVersion(version || undefined);
  return major && !browser.includes(major) ? `${browser} ${major}` : browser;
}

function formatOsLabel(name: string | null, version: string | null): string {
  const osName = cleanString(name) || 'Unknown OS';
  const osVersion = normalizeVersion(version || undefined);
  if (!osVersion || osName.includes(osVersion)) return osName;
  return `${osName} ${osVersion}`;
}

function formatSdkVersion(session: any): string | null {
  const version = readNestedString(session, [
    ['sdkVersion'],
    ['deviceInfo', 'sdkVersion'],
    ['metadata', 'sdkVersion'],
  ]);
  if (version) return `SDK ${version}`;

  const appVersion = readNestedString(session, [
    ['appVersion'],
    ['deviceInfo', 'appVersion'],
    ['metadata', 'appVersion'],
  ]);
  return appVersion ? `v${appVersion}` : null;
}

export function getWebNetworkDisplay(rawNetworkType: unknown): Pick<WebSessionEnvironment, 'networkLabel' | 'networkTitle' | 'rawNetworkType'> {
  const raw = cleanString(rawNetworkType);
  if (!raw) {
    return {
      networkLabel: '—',
      networkTitle: 'Browser network details were not reported.',
      rawNetworkType: null,
    };
  }

  const normalized = raw.toLowerCase().replace(/^effective-/, '');
  const effectiveTitle = `Browser effective connection: ${normalized}. This is a speed estimate, not Wi-Fi vs cellular.`;
  if (normalized === '4g') return { networkLabel: 'Fast', networkTitle: effectiveTitle, rawNetworkType: raw };
  if (normalized === '3g') return { networkLabel: 'Moderate', networkTitle: effectiveTitle, rawNetworkType: raw };
  if (normalized === '2g' || normalized === 'slow-2g') return { networkLabel: 'Slow', networkTitle: effectiveTitle, rawNetworkType: raw };
  if (normalized === 'wifi') return { networkLabel: 'Wi-Fi', networkTitle: 'Network type reported by the client.', rawNetworkType: raw };
  if (normalized === 'cellular') return { networkLabel: 'Cellular', networkTitle: 'Network type reported by the client.', rawNetworkType: raw };

  return {
    networkLabel: raw,
    networkTitle: 'Network detail reported by the client.',
    rawNetworkType: raw,
  };
}

export function getWebSessionEnvironment(session: any): WebSessionEnvironment {
  const userAgent = readUserAgent(session);
  const parsedBrowser = parseBrowserFromUserAgent(userAgent);
  const parsedOs = parseOsFromUserAgent(userAgent);
  const modelParts = splitBrowserAndOsFromModel(readNestedString(session, [['deviceModel'], ['deviceInfo', 'model']]));

  const browserName =
    readNestedString(session, [['browser'], ['deviceInfo', 'browser'], ['metadata', 'browser']]) ||
    modelParts.browser ||
    parsedBrowser?.name ||
    null;
  const browserVersion =
    readNestedString(session, [['browserVersion'], ['deviceInfo', 'browserVersion'], ['metadata', 'browserVersion']]) ||
    parsedBrowser?.version ||
    null;

  const explicitOsName = readNestedString(session, [['os'], ['deviceInfo', 'os'], ['metadata', 'os']]);
  const osName =
    (explicitOsName && !isBrowserPlaceholder(explicitOsName) ? explicitOsName : null) ||
    modelParts.os ||
    parsedOs?.name ||
    null;
  const osVersion =
    readNestedString(session, [['osVersion'], ['deviceInfo', 'osVersion'], ['deviceInfo', 'systemVersion'], ['metadata', 'osVersion']]) ||
    parsedOs?.version ||
    null;

  const network = getWebNetworkDisplay(
    readNestedString(session, [['networkType'], ['deviceInfo', 'networkType'], ['deviceInfo', 'effectiveConnectionType']])
  );
  const browserLabel = formatBrowserLabel(browserName, browserVersion);
  const osLabel = formatOsLabel(osName, osVersion);

  return {
    browserLabel,
    browserTitle: browserVersion ? `${browserLabel} (${browserVersion})` : browserLabel,
    osLabel,
    osTitle: osVersion ? `${osLabel} (${osVersion})` : osLabel,
    sdkVersionLabel: formatSdkVersion(session),
    ...network,
  };
}
