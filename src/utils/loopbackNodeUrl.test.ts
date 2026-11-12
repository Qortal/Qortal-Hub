import { describe, expect, it } from 'vitest';
import { isLoopbackNodeUrl } from './loopbackNodeUrl';

describe('isLoopbackNodeUrl', () => {
  it.each([
    'http://127.0.0.1:12391',
    'https://127.0.0.1:12391',
    'http://localhost:12391',
    'http://LOCALHOST:12391',
    'http://127.1.2.3:12391',
    'http://[::1]:12391',
  ])('accepts this machine: %s', (url) => {
    expect(isLoopbackNodeUrl(url)).toBe(true);
  });

  it.each([
    'http://192.168.1.10:12391',
    'http://10.0.0.5:12391',
    'https://node.example:12391',
    'https://ext-node.qortal.link',
    'http://127.0.0.1.example.com:12391',
    'not a url',
    '',
    null,
    undefined,
  ])('refuses anything else: %s', (url) => {
    expect(isLoopbackNodeUrl(url)).toBe(false);
  });
});
