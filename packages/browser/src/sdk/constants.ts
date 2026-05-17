export const SDK_NAME = '@rejourneyco/browser';
export { SDK_VERSION } from './version.js';

export const DEFAULT_API_URL = 'https://api.rejourney.co';

export const EVENT_FLUSH_INTERVAL_MS = 5_000;
export const EVENT_FLUSH_MAX_EVENTS = 100;
export const RRWEB_FLUSH_INTERVAL_MS = 5_000;
export const RRWEB_FLUSH_MAX_EVENTS = 250;
export const RRWEB_FLUSH_MAX_BYTES = 512 * 1024;
export const QUEUED_CHUNK_TTL_MS = 24 * 60 * 60 * 1000;
export const QUEUED_CHUNK_MAX_BYTES = 20 * 1024 * 1024;
export const QUEUED_CHUNK_MAX_COUNT = 100;

export const SENSITIVE_QUERY_KEYS = [
  'token',
  'key',
  'secret',
  'password',
  'auth',
  'access_token',
  'id_token',
  'refresh_token',
  'api_key',
  'code',
  'state',
  'session',
  'sid',
  'jwt',
  'email',
  'phone',
  'otp',
  'magic',
  'invite',
];

export const DEFAULT_ALLOWED_ATTRIBUTION_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

export const CLICK_ID_PARAMS = [
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
  'msclkid',
  'ttclid',
  'twclid',
  'li_fat_id',
];
