import { describe, expect, it } from 'vitest';
import { applyRemoteConfig, mergeWebConfig } from '../sdk/config.js';
import { buildPrivacyBlockSelector, maskInputValue, sanitizeRrwebEvent } from '../sdk/domPrivacy.js';

describe('dom privacy', () => {
  it('masks serialized input values and placeholders in rrweb snapshots', () => {
    const config = mergeWebConfig('rj_live_test');
    const event = {
      type: 2,
      data: {
        node: {
          type: 2,
          tagName: 'input',
          attributes: {
            type: 'email',
            value: 'person@example.com',
            placeholder: 'person@example.com',
          },
          childNodes: [],
        },
      },
    };

    sanitizeRrwebEvent(event, config);

    expect(event.data.node.attributes.value).toBe('***');
    expect(event.data.node.attributes.placeholder).toBe('***');
  });

  it('leaves non-input serialized attributes alone when all-input masking is disabled', () => {
    const config = mergeWebConfig('rj_live_test', { maskAllInputs: false });
    const event = {
      type: 2,
      data: {
        node: {
          type: 2,
          tagName: 'input',
          attributes: {
            type: 'text',
            placeholder: 'Search products',
          },
          childNodes: [],
        },
      },
    };

    sanitizeRrwebEvent(event, config);

    expect(event.data.node.attributes.placeholder).toBe('Search products');
  });

  it('leaves plain text inputs visible in secure-only masking', () => {
    const config = applyRemoteConfig(mergeWebConfig('rj_live_test'), {
      textInputMasking: 'secure_only',
    });
    const textInput = {
      tagName: 'INPUT',
      type: 'text',
      autocomplete: '',
      matches: () => false,
    } as unknown as HTMLElement;
    const passwordInput = {
      tagName: 'INPUT',
      type: 'password',
      autocomplete: '',
      matches: () => false,
    } as unknown as HTMLElement;

    expect(maskInputValue('Alex Morgan', textInput, config)).toBe('Alex Morgan');
    expect(maskInputValue('super-secret-password', passwordInput, config)).toBe('***');
  });

  it('scrubs serialized image and video attributes when media masking is enabled', () => {
    const config = applyRemoteConfig(mergeWebConfig('rj_live_test'), {
      imageVideoMasking: 'all',
    });
    const event = {
      type: 2,
      data: {
        node: {
          type: 2,
          tagName: 'video',
          attributes: {
            src: '/media/private-demo.mp4',
            poster: '/media/private-poster.png',
            style: 'background-image: url("/media/private-frame.png"); width: 320px;',
          },
          childNodes: [],
        },
      },
    };

    sanitizeRrwebEvent(event, config);

    expect(event.data.node.attributes.src).toBe('***');
    expect(event.data.node.attributes.poster).toBe('***');
    expect(event.data.node.attributes.style).toBe('background-image: none; width: 320px;');
  });

  it('adds media nodes to rrweb block selectors when media masking is enabled', () => {
    const config = applyRemoteConfig(mergeWebConfig('rj_live_test'), {
      imageVideoMasking: 'all',
    });

    expect(buildPrivacyBlockSelector(config)).toContain('img');
    expect(buildPrivacyBlockSelector(config)).toContain('video');
    expect(buildPrivacyBlockSelector(config)).toContain('[data-rj-mask-media]');
  });
});
