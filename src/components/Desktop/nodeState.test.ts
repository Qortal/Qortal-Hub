import { describe, expect, it } from 'vitest';
import { nodeStateFor } from './nodeState';

describe('nodeStateFor', () => {
  it('is public on the public node, and without a node chosen', () => {
    expect(nodeStateFor('https://ext-node.qortal.link', {})).toBe('public');
    expect(nodeStateFor(undefined, {})).toBe('public');
    expect(nodeStateFor('', null)).toBe('public');
  });

  it('never mints on the public node, whatever it reports', () => {
    expect(
      nodeStateFor('https://ext-node.qortal.link', { isMintingPossible: true })
    ).toBe('public');
  });

  it("is the user's own on a local or chosen node", () => {
    expect(nodeStateFor('https://127.0.0.1:12391', {})).toBe('own');
    expect(nodeStateFor('http://127.0.0.1:12391', undefined)).toBe('own');
    expect(
      nodeStateFor('https://my-node.example:12391', {
        isMintingPossible: false,
      })
    ).toBe('own');
  });

  it('mints when the own node can mint', () => {
    expect(
      nodeStateFor('https://127.0.0.1:12391', { isMintingPossible: true })
    ).toBe('minting');
  });
});
