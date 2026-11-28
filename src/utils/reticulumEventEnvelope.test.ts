import { describe, expect, it } from 'vitest';
import { mergeReticulumPayloadWithVerifiedEnvelope } from './reticulumEventEnvelope';

describe('Reticulum renderer event envelope', () => {
  it('keeps verified metadata authoritative over payload fields', () => {
    const payload = {
      messageText: 'hello',
      sender: 'spoofed-address',
      senderName: 'Spoofed name',
      signature: 'spoofed-event',
      timestamp: 1,
      channelId: 'spoofed-channel',
      chatReference: 'spoofed-target',
      eventType: 'delete',
      privilegedMentionAuthorized: true,
      expiresAt: 1,
    };
    const envelope = {
      sender: 'verified-address',
      senderName: 'Verified name',
      signature: 'verified-event',
      timestamp: 42,
      channelId: 'general',
      chatReference: 'verified-target',
      eventType: 'edit',
      privilegedMentionAuthorized: false,
      expiresAt: 100,
    };

    const merged = mergeReticulumPayloadWithVerifiedEnvelope(payload, envelope);
    expect(merged).toMatchObject(envelope);
    expect(merged.decryptedData).toBe(payload);
  });

  it('does not expose reserved fields omitted by the envelope', () => {
    const payload = {
      messageText: 'hello',
      reticulumDirect: true,
      recipientAddress: 'spoofed-recipient',
      groupId: 999,
    };

    const merged = mergeReticulumPayloadWithVerifiedEnvelope(payload, {
      reticulumChat: true,
    });
    expect(merged).toMatchObject({
      messageText: 'hello',
      reticulumChat: true,
    });
    expect(merged).not.toHaveProperty('reticulumDirect');
    expect(merged).not.toHaveProperty('recipientAddress');
    expect(merged).not.toHaveProperty('groupId');
    expect(merged.decryptedData).toBe(payload);
  });
});
