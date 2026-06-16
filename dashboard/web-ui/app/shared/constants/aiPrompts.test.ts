import { describe, expect, it } from 'vitest';
import { buildProjectAIIntegrationPrompt } from './aiPrompts';

describe('buildProjectAIIntegrationPrompt', () => {
  it('includes dashboard project context before the integration instructions', () => {
    const prompt = buildProjectAIIntegrationPrompt({
      teamName: 'Growth Team',
      name: 'Checkout App',
      publicKey: 'pk_live_checkout_123',
      platforms: ['web', 'ios', 'android', 'react-native'],
      webAllowedDomains: ['checkout.example.com', '*.example.com'],
      bundleId: 'com.example.checkout',
      packageName: 'com.example.checkout',
    });

    expect(prompt).toContain('PROJECT CONTEXT FROM REJOURNEY DASHBOARD:');
    expect(prompt).toContain('- Team: Growth Team');
    expect(prompt).toContain('- Project: Checkout App');
    expect(prompt).toContain('- Public key: pk_live_checkout_123');
    expect(prompt).toContain('- Selected platforms: Web, iOS, Android, React Native');
    expect(prompt).toContain('- Web allowed domains: checkout.example.com, *.example.com');
    expect(prompt).toContain('- iOS bundle ID: com.example.checkout');
    expect(prompt).toContain('- Android package name: com.example.checkout');
    expect(prompt).toContain('verify the detected app matches these domains, bundle IDs, and package names');
    expect(prompt).not.toContain('PUBLIC_KEY_HERE');
  });

  it('omits empty project context values', () => {
    const prompt = buildProjectAIIntegrationPrompt({
      publicKey: 'pk_live_minimal_123',
      platforms: [],
      webAllowedDomains: [],
      bundleId: '',
      packageName: '',
    });
    const contextBlock = prompt.split('\n\n')[0];

    expect(contextBlock).toContain('- Public key: pk_live_minimal_123');
    expect(contextBlock).not.toContain('- Team:');
    expect(contextBlock).not.toContain('- Project:');
    expect(contextBlock).not.toContain('- Selected platforms:');
    expect(contextBlock).not.toContain('- Web allowed');
    expect(contextBlock).not.toContain('- iOS bundle ID:');
    expect(contextBlock).not.toContain('- Android package name:');
  });
});
