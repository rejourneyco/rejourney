import { getCurrentUrl, getDocument, getLocation, getNavigator, getOrigin } from './browser.js';
import type { RejourneyWebConfig, WebRecordingContext } from './types.js';

const OBVIOUS_NON_BROWSER_PATTERN = /\b(curl|wget|python-requests|httpclient|libwww-perl|go-http-client|okhttp|linkchecker|uptime|pingdom|statuscake|headlesschrome|phantomjs)\b/i;

export async function classifyWebClient(config: RejourneyWebConfig): Promise<{
  shouldRecord: boolean;
  reason?: 'bot' | 'automation' | 'prerender' | 'customer_filter' | 'non_browser';
  context: WebRecordingContext;
}> {
  const nav = getNavigator();
  const doc = getDocument();
  const location = getLocation();
  const userAgent = nav?.userAgent || '';
  const context: WebRecordingContext = {
    userAgent,
    url: getCurrentUrl(),
    origin: getOrigin(),
    referrer: doc?.referrer || '',
    webdriver: nav?.webdriver === true,
    prerendering: Boolean((doc as Document & { prerendering?: boolean } | null)?.prerendering),
  };

  if (!location || !doc || !nav) {
    return { shouldRecord: false, reason: 'non_browser', context };
  }

  if (context.prerendering) {
    return { shouldRecord: false, reason: 'prerender', context };
  }

  if (context.webdriver && config.recordAutomation !== true) {
    return { shouldRecord: false, reason: 'automation', context };
  }

  if (config.ignoreBots !== false) {
    if (config.botUserAgentPattern?.test(userAgent) || OBVIOUS_NON_BROWSER_PATTERN.test(userAgent)) {
      return { shouldRecord: false, reason: 'bot', context };
    }

    try {
      const mod = await import('isbot');
      if (mod.isbot(userAgent)) {
        return { shouldRecord: false, reason: 'bot', context };
      }
    } catch {
      if (/bot|crawler|spider|preview|slackbot|discordbot|facebookexternalhit|googlebot|bingbot/i.test(userAgent)) {
        return { shouldRecord: false, reason: 'bot', context };
      }
    }
  }

  if (config.shouldRecord && config.shouldRecord(context) === false) {
    return { shouldRecord: false, reason: 'customer_filter', context };
  }

  return { shouldRecord: true, context };
}
