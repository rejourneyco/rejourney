import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_SERVER_URL, resolveMcpServerUrl } from '~/shared/config/runtimeEnv';

describe('MCP server URL', () => {
  it('defaults to the hosted address', () => {
    expect(DEFAULT_MCP_SERVER_URL).toBe('https://mcp.rejourney.co/mcp');
    expect(resolveMcpServerUrl(undefined)).toBe(DEFAULT_MCP_SERVER_URL);
    expect(resolveMcpServerUrl('')).toBe(DEFAULT_MCP_SERVER_URL);
    expect(resolveMcpServerUrl('   ')).toBe(DEFAULT_MCP_SERVER_URL);
  });

  it('accepts an http or https override from the runtime environment', () => {
    expect(resolveMcpServerUrl('https://mcp.example.com/mcp')).toBe('https://mcp.example.com/mcp');
    expect(resolveMcpServerUrl(' http://localhost:8787/mcp ')).toBe('http://localhost:8787/mcp');
  });

  it('ignores values that are not web addresses', () => {
    expect(resolveMcpServerUrl('mcp.example.com/mcp')).toBe(DEFAULT_MCP_SERVER_URL);
    expect(resolveMcpServerUrl('javascript:alert(1)')).toBe(DEFAULT_MCP_SERVER_URL);
    expect(resolveMcpServerUrl('https://mcp.example.com/mcp extra')).toBe(DEFAULT_MCP_SERVER_URL);
  });
});
