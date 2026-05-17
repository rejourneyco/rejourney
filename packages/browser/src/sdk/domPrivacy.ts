import type { RejourneyWebConfig } from './types.js';

const DEFAULT_MASK = '***';
const SENSITIVE_SERIALIZED_ATTRIBUTES = ['value', 'placeholder'];

function elementMatches(element: HTMLElement, selector?: string): boolean {
  if (!selector || typeof element.matches !== 'function') return false;
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function isAlwaysSensitiveInput(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return false;
  const input = element as HTMLInputElement;
  const type = (input.type || '').toLowerCase();
  return type === 'password'
    || type === 'email'
    || type === 'tel'
    || type === 'hidden'
    || type === 'number'
    || input.autocomplete === 'one-time-code'
    || elementMatches(element, '[autocomplete*="cc-"], [name*="card"], [name*="cvv"], [name*="otp"], [data-private]');
}

export function shouldMaskInput(element: HTMLElement, config: RejourneyWebConfig): boolean {
  if (isAlwaysSensitiveInput(element)) return true;
  if (elementMatches(element, config.maskTextSelector)) return true;

  const tag = element.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea' && !element.isContentEditable) return false;
  if (config.maskAllInputs !== false) return true;

  const type = (element as HTMLInputElement).type || 'text';
  return config.maskInputOptions?.[type] === true;
}

export function maskInputValue(value: string, element: HTMLElement, config: RejourneyWebConfig): string {
  if (config.maskInputFn) return config.maskInputFn(value, element);
  return shouldMaskInput(element, config) ? DEFAULT_MASK : value;
}

export function maskTextValue(text: string, element: HTMLElement, config: RejourneyWebConfig): string {
  if (config.maskTextFn) return config.maskTextFn(text, element);
  if (elementMatches(element, config.maskTextSelector)) return DEFAULT_MASK;
  return text;
}

function serializedNodeShouldMaskInput(tagName: string, attributes: Record<string, unknown>, config: RejourneyWebConfig): boolean {
  const tag = tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return false;

  const type = String(attributes.type || '').toLowerCase();
  const autocomplete = String(attributes.autocomplete || '').toLowerCase();
  const name = String(attributes.name || '').toLowerCase();

  if (
    type === 'password'
    || type === 'email'
    || type === 'tel'
    || type === 'hidden'
    || type === 'number'
    || autocomplete === 'one-time-code'
    || autocomplete.includes('cc-')
    || name.includes('card')
    || name.includes('cvv')
    || name.includes('otp')
    || attributes['data-private'] !== undefined
  ) {
    return true;
  }

  return config.maskAllInputs !== false;
}

function sanitizeSerializedNode(value: unknown, config: RejourneyWebConfig, seen: WeakSet<object>): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  const node = value as Record<string, unknown>;
  const attributes = node.attributes;
  const tagName = node.tagName;
  if (attributes && typeof attributes === 'object' && typeof tagName === 'string') {
    const attrs = attributes as Record<string, unknown>;
    if (serializedNodeShouldMaskInput(tagName, attrs, config)) {
      for (const attr of SENSITIVE_SERIALIZED_ATTRIBUTES) {
        if (attrs[attr] !== undefined && attrs[attr] !== null && String(attrs[attr]) !== '') {
          attrs[attr] = DEFAULT_MASK;
        }
      }
    }
  }

  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) sanitizeSerializedNode(item, config, seen);
    } else {
      sanitizeSerializedNode(child, config, seen);
    }
  }
}

export function sanitizeRrwebEvent(event: unknown, config: RejourneyWebConfig): unknown {
  sanitizeSerializedNode(event, config, new WeakSet<object>());
  return event;
}

export function applyPrivacyAttributes(root: ParentNode = document): void {
  root.querySelectorAll('[data-rejourney-mask]').forEach((node) => node.classList.add('rr-mask'));
  root.querySelectorAll('[data-rejourney-block]').forEach((node) => node.classList.add('rr-block'));
  root.querySelectorAll('[data-rejourney-ignore]').forEach((node) => node.classList.add('rr-ignore'));
}
