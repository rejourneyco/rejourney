import { describe, expect, it } from 'vitest';
import {
    AI_INTEGRATION_PROMPT,
    SHOPIFY_AI_INTEGRATION_PROMPT,
    buildAIPromptUrl,
    buildProjectAIPromptById,
    buildProjectAIPromptLinkInstruction,
    buildProjectAIIntegrationPrompt,
    buildSelfHostedAIDeploymentPrompt,
    getAIPromptIdsForProject,
} from './aiPrompts';

describe('buildProjectAIIntegrationPrompt', () => {
  it('includes Redux Toolkit replay setup and privacy guidance in the web prompt', () => {
    expect(AI_INTEGRATION_PROMPT).toContain("from '@rejourneyco/browser/redux'");
    expect(AI_INTEGRATION_PROMPT).toContain('getDefaultMiddleware().concat(');
    expect(AI_INTEGRATION_PROMPT).toContain("captureState: 'after'");
    expect(AI_INTEGRATION_PROMPT).toContain('IF FLUTTER');
    expect(AI_INTEGRATION_PROMPT).toContain('RejourneyNavigatorObserver');
  });

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
    expect(prompt).toContain('- Selected platforms: Web, React Native');
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

  it('builds platform-specific prompt URLs with project context', () => {
    const promptUrl = buildAIPromptUrl('web', {
      publicKey: 'pk_live_checkout_123',
      name: 'Checkout App',
      platforms: ['web'],
      webAllowedDomains: ['checkout.example.com'],
    }, 'https://example.test');

    expect(promptUrl).toContain('https://example.test/docs/ai-prompts/web?');
    expect(promptUrl).toContain('publicKey=pk_live_checkout_123');
    expect(promptUrl).toContain('project=Checkout+App');
    expect(promptUrl).toContain('webAllowedDomains=checkout.example.com');
  });

  it('copies a short instruction that points to the platform prompt URL', () => {
    const instruction = buildProjectAIPromptLinkInstruction('web', {
      publicKey: 'pk_live_checkout_123',
      platforms: ['web'],
    }, 'https://example.test');

    expect(instruction).toContain('Use the Rejourney Web SDK AI setup prompt at this URL:');
    expect(instruction).toContain('https://example.test/docs/ai-prompts/web?');
    expect(instruction).toContain('The URL returns the full plain-text prompt');
    expect(instruction).not.toContain('IF REACT NATIVE');
  });

  it('copies a concise self-hosted handoff with the canonical guide and routing warning', () => {
    const instruction = buildSelfHostedAIDeploymentPrompt();

    expect(instruction).toContain('https://rejourney.co/docs/selfhosted');
    expect(instruction).toContain("manually set the self-hosted API URL");
    expect(instruction).toContain("apiUrl: 'https://api.<domain>'");
    expect(instruction).toContain('apiURL: URL(string: "https://api.<domain>")!');
    expect(instruction).toContain('SDK defaults to https://api.rejourney.co');
    expect(instruction).toContain('recordings go to Rejourney Cloud instead of my server');
    expect(instruction).toContain('Use a project public key created in my self-hosted dashboard');
    expect(instruction).toContain('Leaks, Automations, and their GitHub setup to be hidden');
    expect(instruction).toContain('Keep built-in MinIO private');
    expect(instruction).toContain('recording a real test session');
    expect(instruction.length).toBeLessThan(3000);
    expect(instruction).not.toContain('Troubleshooting hints to include:');
  });

  it('returns a web-only prompt body from the hidden prompt builder', () => {
    const prompt = buildProjectAIPromptById('web', {
      publicKey: 'pk_live_web_123',
      platforms: ['web'],
    });

    expect(prompt).toContain('IF WEB');
    expect(prompt).toContain('pk_live_web_123');
    expect(prompt).not.toContain('IF REACT NATIVE');
    expect(prompt).not.toContain('IF SWIFT');
  });

  it('adds Shopify guidance while preserving the web setup body', () => {
    expect(SHOPIFY_AI_INTEGRATION_PROMPT).toContain('IF WEB');
    expect(SHOPIFY_AI_INTEGRATION_PROMPT).toContain('SHOPIFY IMPORTANT NOTES AND DIFFERENCES');
    expect(SHOPIFY_AI_INTEGRATION_PROMPT).toContain('Shopify custom theme');
    expect(SHOPIFY_AI_INTEGRATION_PROMPT).toContain('checkout_started');
  });

  it('offers Shopify prompt links alongside web prompts for web projects', () => {
    expect(getAIPromptIdsForProject({
      publicKey: 'pk_live_web_123',
      platforms: ['web'],
    })).toEqual(['web', 'shopify']);

    expect(getAIPromptIdsForProject({
      publicKey: 'pk_live_shopify_123',
      name: 'Shopify Storefront',
      platforms: ['web'],
      webAllowedDomains: ['store.myshopify.com'],
    })).toEqual(['shopify', 'web']);
  });

  it('does not treat React Native runtime markers as separate native SDK integrations', () => {
    expect(getAIPromptIdsForProject({
      publicKey: 'pk_live_mobile_123',
      platforms: ['react-native', 'ios', 'android'],
    })).toEqual(['react-native']);
  });

  it('returns a Flutter-specific setup prompt for Flutter projects', () => {
    expect(getAIPromptIdsForProject({
      publicKey: 'pk_live_flutter_123',
      platforms: ['flutter', 'ios', 'android'],
    })).toEqual(['flutter']);

    const prompt = buildProjectAIPromptById('flutter', {
      publicKey: 'pk_live_flutter_123',
      platforms: ['flutter'],
    });
    expect(prompt).toContain('IF FLUTTER');
    expect(prompt).toContain('pk_live_flutter_123');
    expect(prompt).toContain('RejourneyMask');
    expect(prompt).not.toContain('IF SWIFT');
  });
});
