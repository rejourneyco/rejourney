import { describe, expect, it } from 'vitest';
import { mergeWebConfig } from '../sdk/config.js';
import { sanitizeRrwebEvent } from '../sdk/domPrivacy.js';

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
});
