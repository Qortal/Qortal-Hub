import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  joinDirectVoiceReticulumRoom,
  leaveDirectVoiceReticulumRoom,
  signGcJoin,
} from './directVoiceReticulumMedia';

describe('directVoiceReticulumMedia', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('signs and forwards GC_JOIN_RK when a Reticulum identity key is available', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ signature: 'join-sig' })
      .mockResolvedValueOnce({ signature: 'join-rk-sig' });
    const join = vi.fn(async () => ({
      success: true,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
    }));
    const setLocalAddresses = vi.fn(async () => {});

    Object.assign(window as any, {
      sendMessage,
      groupCall: {
        join,
        setLocalAddresses,
      },
    });

    const result = await joinDirectVoiceReticulumRoom({
      roomId: 'dmv:0123456789abcdef01',
      chatId: 'direct:Qa:Qb',
      address: 'Qa',
      publicKey: 'qortal-pub',
      reticulumDestinationHash: 'a'.repeat(32),
      reticulumIdentityPublicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
    });

    expect(result).toMatchObject({
      success: true,
      callSessionId: 'call-session',
      mediaSessionGeneration: 1,
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      'signPresenceMessage',
      expect.objectContaining({
        type: 'GC_JOIN',
        reticulumDestinationHash: 'a'.repeat(32),
      }),
      10_000
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      'signPresenceMessage',
      expect.objectContaining({
        type: 'GC_JOIN_RK',
        reticulumDestinationHash: 'a'.repeat(32),
        reticulumIdentityPublicKeyBase64: 'cmV0aWN1bHVtLWlkZW50aXR5',
      }),
      10_000
    );
    expect(setLocalAddresses).toHaveBeenCalledWith(['Qa'], 'dm');
    expect(join).toHaveBeenCalledWith(
      'dmv:0123456789abcdef01',
      'direct:Qa:Qb',
      'Qa',
      'join-sig',
      'qortal-pub',
      expect.any(Number),
      'a'.repeat(32),
      undefined,
      0,
      'cmV0aWN1bHVtLWlkZW50aXR5',
      'join-rk-sig'
    );
  });

  it('signGcJoin returns only GC_JOIN when no Reticulum identity key is provided', async () => {
    Object.assign(window as any, {
      sendMessage: vi.fn(async () => ({ signature: 'join-sig' })),
    });

    const signatures = await signGcJoin({
      roomId: 'dmv:0123456789abcdef01',
      chatId: 'direct:Qa:Qb',
      fromAddress: 'Qa',
      fromPublicKey: 'qortal-pub',
      timestamp: 1_234,
      reticulumDestinationHash: 'b'.repeat(32),
    });

    expect(signatures).toEqual({ joinSig: 'join-sig' });
  });

  it('clears the DM local-address registration when leaving the Reticulum room', async () => {
    const leave = vi.fn(async () => {});
    const setLocalAddresses = vi.fn(async () => {});

    Object.assign(window as any, {
      sendMessage: vi.fn(async () => ({ signature: 'leave-sig' })),
      groupCall: {
        leave,
        setLocalAddresses,
      },
    });

    await leaveDirectVoiceReticulumRoom({
      roomId: 'dmv:0123456789abcdef01',
      address: 'Qa',
      publicKey: 'qortal-pub',
    });

    expect(leave).toHaveBeenCalledWith(
      'dmv:0123456789abcdef01',
      'Qa',
      'leave-sig',
      'qortal-pub',
      expect.any(Number)
    );
    expect(setLocalAddresses).toHaveBeenCalledWith([], 'dm');
  });
});
