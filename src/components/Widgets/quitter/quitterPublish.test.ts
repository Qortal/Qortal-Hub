import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n/i18n';
import { quitterHashString } from './quitterIdentity';
import {
  firstMentionKeyword,
  normalizePostText,
  publishMultipleResources,
  QuitterPublishCancelledError,
} from './quitterPublish';

const sendMessage = vi.fn();
const resources = [{ service: 'DOCUMENT', identifier: 'q', name: 'Alice' }];

beforeEach(() => {
  sendMessage.mockReset();
  window.sendMessage = sendMessage;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('publishMultipleResources', () => {
  it("publishes through Hub's own request, with its approval dialog", async () => {
    sendMessage.mockResolvedValue([{ signature: 'sig' }]);
    await expect(publishMultipleResources(resources)).resolves.toEqual([
      { signature: 'sig' },
    ]);
    expect(sendMessage).toHaveBeenCalledWith(
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      { resources },
      240000,
      true
    );
  });

  it('treats a declined approval as a cancel, in any language', async () => {
    sendMessage.mockResolvedValue({
      error: 'User declined request',
      message: 'User declined request',
    });
    await expect(publishMultipleResources(resources)).rejects.toBeInstanceOf(
      QuitterPublishCancelledError
    );

    await i18n.changeLanguage('de');
    const declined = i18n.t('question:message.generic.user_declined_request', {
      postProcess: 'capitalizeFirstChar',
    });
    expect(declined).not.toBe('User declined request');
    sendMessage.mockResolvedValue({ error: declined, message: declined });
    await expect(publishMultipleResources(resources)).rejects.toBeInstanceOf(
      QuitterPublishCancelledError
    );
  });

  it('passes on why Hub could not publish', async () => {
    sendMessage.mockResolvedValue({
      error: 'Insufficient balance',
      message: 'Insufficient balance',
    });
    await expect(publishMultipleResources(resources)).rejects.toThrow(
      'Insufficient balance'
    );

    sendMessage.mockResolvedValue({
      message: 'Some resources have failed to publish',
      error: {
        unsuccessfulPublishes: [
          { identifier: 'q', reason: 'Node is not synced' },
        ],
      },
    });
    await expect(publishMultipleResources(resources)).rejects.toThrow(
      'Node is not synced'
    );
  });

  it('says publishing failed when Hub never answers', async () => {
    sendMessage.mockRejectedValue({ error: 'timeout', message: 'timed out' });
    await expect(publishMultipleResources(resources)).rejects.toThrow(
      'Failed to publish'
    );
  });

  it('sends nothing once cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      publishMultipleResources(resources, abort.signal)
    ).rejects.toBeInstanceOf(QuitterPublishCancelledError);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('post text helpers', () => {
  it('keeps plain text, and turns HTML into plain text', () => {
    expect(normalizePostText(' a\r\nb\n\n\n\nc ')).toBe('a\nb\n\nc');
    expect(normalizePostText('<p>a &amp; b</p><p>c</p>')).toBe('a & b\nc');
  });

  it('hashes the first @mention for the description', async () => {
    expect(await firstMentionKeyword('no mention here')).toBe('');
    expect(await firstMentionKeyword('hi @Bob and @Carol')).toBe(
      `~@${await quitterHashString('Bob')}~`
    );
    expect(await firstMentionKeyword('hi @{Big Name} there')).toBe(
      `~@${await quitterHashString('Big Name')}~`
    );
  });
});
