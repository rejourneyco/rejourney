import { describe, expect, it } from 'vitest';
import {
  getAndroidPackageError,
  getIosBundleIdError,
  getWebAllowedDomainsError,
  parseWebAllowedDomainsInput,
} from './validation';

describe('setup validation helpers', () => {
  it('normalizes allowed web domains the same way setup and settings do', () => {
    expect(parseWebAllowedDomainsInput([
      'https://Checkout.Example.com/path',
      'checkout.example.com',
      '*.Example.com',
      'localhost:3000',
    ].join('\n'))).toEqual([
      'checkout.example.com',
      '*.example.com',
      'localhost:3000',
    ]);
  });

  it('requires at least one valid web domain when web setup is selected', () => {
    expect(getWebAllowedDomainsError('', true)).toBe('Add at least one allowed domain');
    expect(getWebAllowedDomainsError('https://app.example.com/path', true)).toBeNull();
    expect(getWebAllowedDomainsError('not a domain', true)).toBe('Add at least one allowed domain');
    expect(getWebAllowedDomainsError('app.example.com, bad domain', true)).toBe('Use valid domains like app.example.com, www.example.com, or *.example.com');
  });

  it('keeps native identifier validation aligned for setup fields', () => {
    expect(getIosBundleIdError('com.example.ios')).toBeNull();
    expect(getAndroidPackageError('com.example.android')).toBeNull();
    expect(getIosBundleIdError('com..example')).toBe('Cannot contain consecutive periods');
    expect(getAndroidPackageError('.com.example')).toBe('Cannot start or end with a period');
  });
});
