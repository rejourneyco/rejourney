import { applyPrivacyAttributes, maskInputValue, maskTextValue, sanitizeRrwebEvent } from './domPrivacy.js';
import type { RejourneyWebConfig } from './types.js';

export interface RrwebRecorderHandle {
  stop: () => void;
}

export async function startRrwebRecorder(
  config: RejourneyWebConfig,
  emit: (event: unknown) => void,
): Promise<RrwebRecorderHandle | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  applyPrivacyAttributes(document);

  const [{ record }, consolePlugin] = await Promise.all([
    import('@rrweb/record'),
    config.trackConsoleLogs ? import('@rrweb/rrweb-plugin-console-record').catch(() => null) : Promise.resolve(null),
  ]);

  const plugins = [];
  const consoleRecord = consolePlugin && 'getRecordConsolePlugin' in consolePlugin
    ? consolePlugin.getRecordConsolePlugin
    : null;
  if (config.trackConsoleLogs && typeof consoleRecord === 'function') {
    plugins.push(consoleRecord());
  }

  const stop = record({
    emit: (event) => emit(sanitizeRrwebEvent(event, config)),
    blockClass: typeof config.blockClass === 'string' ? config.blockClass : undefined,
    blockSelector: config.blockSelector,
    ignoreClass: typeof config.ignoreClass === 'string' ? config.ignoreClass : undefined,
    ignoreSelector: config.ignoreSelector,
    maskTextClass: typeof config.maskTextClass === 'string' ? config.maskTextClass : undefined,
    maskTextSelector: config.maskTextSelector,
    maskAllInputs: config.maskAllInputs !== false,
    maskInputOptions: config.maskInputOptions,
    maskInputFn: (value, element) => maskInputValue(value, element as HTMLElement, config),
    maskTextFn: (text, element) => maskTextValue(text, element as HTMLElement, config),
    checkoutEveryNms: config.rrweb?.checkoutEveryNms,
    checkoutEveryNth: config.rrweb?.checkoutEveryNth,
    sampling: config.rrweb?.sampling,
    inlineStylesheet: config.rrweb?.inlineStylesheet === 'all' ? true : config.rrweb?.inlineStylesheet,
    inlineImages: config.rrweb?.inlineImages,
    collectFonts: config.rrweb?.collectFonts,
    recordCanvas: config.rrweb?.recordCanvas,
    plugins,
  });

  return stop ? { stop } : null;
}
