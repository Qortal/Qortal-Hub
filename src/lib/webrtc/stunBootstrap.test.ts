import { describe, expect, it } from 'vitest';
import {
  buildBootstrapIceServers,
  STUN_FIXED_UDP_PORT,
} from './stunBootstrap';
import golden from './__fixtures__/bootstrap-stun-golden.json';

describe('stunBootstrap', () => {
  it('matches golden fixture URLs (keep in sync with electron/src/stun-bootstrap.ts)', () => {
    const servers = buildBootstrapIceServers(golden.seedAddrs);
    expect(servers.map((s) => s.urls)).toEqual(golden.expectedUrls);
  });

  it('deduplicates identical seeds', () => {
    const s = buildBootstrapIceServers(['a:1', 'a:1']);
    expect(s).toHaveLength(1);
    expect(s[0].urls).toBe(`stun:a:${STUN_FIXED_UDP_PORT}`);
  });
});
