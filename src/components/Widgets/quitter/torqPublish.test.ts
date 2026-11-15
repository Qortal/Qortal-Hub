import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CompressorOptions = { success: (result: Blob) => void };

// Compressor.js needs a real canvas. Here it hands back its input, as it does
// when a re-encode would be bigger: the photo then goes out stripped.
vi.mock('compressorjs', () => ({
  default: class {
    constructor(file: Blob, opts: CompressorOptions) {
      opts.success(file);
    }
  },
}));

import { quitterHashString } from './quitterIdentity';
import { QuitterPublishCancelledError } from './quitterPublish';
import {
  needsTorqPostLink,
  normalizeTorqPoll,
  packTorqHashtagKeywords,
  publishTorqPost,
  TORQ_MAX_IMAGES,
} from './torqPublish';

const POST_ID = /^MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-[0-9A-Za-z]{15}-v1$/;

const sendMessage = vi.fn();

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      resolve(__dirname, '../../../utils/__fixtures__/media-metadata', name)
    )
  );

const photo = (name = 'IMG_1.jpg') =>
  new File([fixture('phone-exif-gps.jpg')], name, { type: 'image/jpeg' });

const decode = (base64: string) =>
  JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    )
  );

/** The resources of the one PUBLISH_MULTIPLE_QDN_RESOURCES request. */
const publishedResources = () => {
  expect(sendMessage).toHaveBeenCalledTimes(1);
  const [action, payload, timeout, isExtension, appInfo] =
    sendMessage.mock.calls[0];
  expect(action).toBe('PUBLISH_MULTIPLE_QDN_RESOURCES');
  expect(timeout).toBe(240000);
  expect(isExtension).toBe(true);
  expect(appInfo).toBeUndefined();
  return (payload as { resources: Record<string, unknown>[] }).resources;
};

const publishedPost = () => {
  const [resource] = publishedResources();
  return decode(String(resource.base64));
};

beforeEach(() => {
  sendMessage.mockReset();
  sendMessage.mockResolvedValue([{ signature: 'sig' }]);
  window.sendMessage = sendMessage;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Torq helpers', () => {
  it('normalizes polls like Torq: trim, drop empty and duplicate choices', () => {
    expect(normalizeTorqPoll([' Yes ', '', 'yes', 'No'])).toEqual({
      options: [
        { id: 'opt_1', text: 'Yes' },
        { id: 'opt_4', text: 'No' },
      ],
    });
    expect(normalizeTorqPoll(['Only one', ''])).toBeNull();
    expect(normalizeTorqPoll(['A', 'a'])).toBeNull();
    expect(normalizeTorqPoll(['x'.repeat(100), 'B'])?.options[0].text).toBe(
      'x'.repeat(80)
    );
    const anon = normalizeTorqPoll(['A', 'B'], { anonymous: true });
    expect(anon?.anonymous).toBe(true);
    expect(atob(anon!.voteKey!).length).toBe(32);
  });

  it('packs every hashtag that fits the 240-byte description', () => {
    expect(
      packTorqHashtagKeywords(['#Qortal', '#qortal', '#Torq'], ['~@x~'])
    ).toBe('~#qortal~,~#torq~');
    const many = Array.from({ length: 60 }, (_, i) => `#tag${i}`);
    const packed = packTorqHashtagKeywords(many);
    expect(new TextEncoder().encode(packed).length).toBeLessThanOrEqual(240);
  });

  it('adds the Torq link when Quitter cannot show everything', () => {
    expect(needsTorqPostLink({ hasPoll: false, imageCount: 0 })).toBe(false);
    expect(needsTorqPostLink({ hasPoll: false, imageCount: 4 })).toBe(false);
    expect(needsTorqPostLink({ hasPoll: false, imageCount: 5 })).toBe(true);
    expect(needsTorqPostLink({ hasPoll: true, imageCount: 0 })).toBe(true);
  });
});

describe('publishTorqPost', () => {
  it('publishes a text post as one Quitter DOCUMENT', async () => {
    const { postIdentifier } = await publishTorqPost({
      text: '  Just words\r\n\r\n\r\nand more  ',
      userName: 'Alice',
    });

    const [resource] = publishedResources();
    expect(postIdentifier).toMatch(POST_ID);
    expect(Object.keys(resource).sort()).toEqual([
      'base64',
      'identifier',
      'name',
      'service',
    ]);
    expect(resource).toMatchObject({
      identifier: postIdentifier,
      name: 'Alice',
      service: 'DOCUMENT',
    });
    const post = publishedPost();
    expect(Object.keys(post)).toEqual(['text', 'timestamp', 'name']);
    expect(post.text).toBe('Just words\n\nand more');
    expect(post.name).toBe('Alice');
    expect(typeof post.timestamp).toBe('number');
  });

  it('keeps the rich text beside the plain text', async () => {
    await publishTorqPost({
      text: 'Hi bold\n\n• one\n• two',
      richText:
        '<p>Hi <b>bold</b></p><ul data-list="disc"><li>one</li><li>two</li></ul>',
      userName: 'Alice',
    });
    expect(publishedPost()).toMatchObject({
      text: 'Hi bold\n\n• one\n• two',
      richText:
        '<p>Hi <b>bold</b></p><ul data-list="disc"><li>one</li><li>two</li></ul>',
    });
  });

  it('describes hashtags and the first mention as Quitter does', async () => {
    await publishTorqPost({
      text: 'Hello #Qortal and #torq #qortal @Bob',
      userName: 'Alice',
    });
    const [resource] = publishedResources();
    expect(resource.description).toBe(
      `~#qortal~,~#torq~,~@${await quitterHashString('Bob')}~`
    );
  });

  it('publishes a poll with the post’s own Torq link for Quitter readers', async () => {
    const { postIdentifier } = await publishTorqPost({
      text: 'Vote!',
      userName: 'Alice',
      poll: normalizeTorqPoll(['Yes', 'No', 'yes', '']),
    });
    const post = publishedPost();
    expect(post.poll).toEqual({
      options: [
        { id: 'opt_1', text: 'Yes' },
        { id: 'opt_2', text: 'No' },
      ],
    });
    expect(post.text).toBe(
      `Vote!\n\nqortal://APP/Torq/post/Alice/${postIdentifier}`
    );
  });

  it('publishes a poll on its own', async () => {
    const { postIdentifier } = await publishTorqPost({
      text: '',
      userName: 'Alice',
      poll: normalizeTorqPoll(['A', 'B'], { anonymous: true, voteKey: 'k' }),
    });
    const post = publishedPost();
    expect(post.text).toBe(`qortal://APP/Torq/post/Alice/${postIdentifier}`);
    expect(post.poll).toEqual({
      options: [
        { id: 'opt_1', text: 'A' },
        { id: 'opt_2', text: 'B' },
      ],
      anonymous: true,
      voteKey: 'k',
    });
  });

  it('publishes photos inline, as raw base64 without their GPS/camera data', async () => {
    await publishTorqPost({
      text: 'holiday',
      userName: 'Alice',
      images: [{ file: photo() }, { file: photo('IMG_2.jpg') }],
    });
    const post = publishedPost();
    expect(post.images).toHaveLength(2);
    for (const image of post.images) {
      expect(Object.keys(image)).toEqual(['src']);
      expect(image.src.startsWith('data:')).toBe(false);
      const body = Buffer.from(image.src, 'base64').toString('latin1');
      expect(body.startsWith('\xff\xd8')).toBe(true);
      expect(body).not.toContain('GPSSECRET');
      expect(body).not.toContain('PrivateModel');
    }
    // Four photos or fewer: Quitter shows them all, so no Torq link.
    expect(post.text).toBe('holiday');
  });

  it('links to Torq when Quitter would clip the photos', async () => {
    const { postIdentifier } = await publishTorqPost({
      text: 'five',
      userName: 'Alice',
      images: Array.from({ length: 5 }, (_, i) => ({
        file: photo(`IMG_${i}.jpg`),
      })),
    });
    const post = publishedPost();
    expect(post.images).toHaveLength(5);
    expect(post.text).toBe(
      `five\n\nqortal://APP/Torq/post/Alice/${postIdentifier}`
    );
  });

  it('reports progress, then hands the post to the approval dialog', async () => {
    const steps: string[] = [];
    await publishTorqPost({
      text: 'hi',
      userName: 'Alice',
      images: [{ file: photo() }],
      onProgress: (message) => steps.push(message),
      onSubmitted: () => {
        steps.push('submitted');
        expect(sendMessage).not.toHaveBeenCalled();
      },
    });
    expect(steps).toEqual([
      'Preparing post…',
      'Compressing images… (1/1)',
      'Publishing post…',
      'submitted',
    ]);
  });

  it('refuses an empty post, too many photos, or no name', async () => {
    await expect(
      publishTorqPost({ text: '  ', userName: 'Alice' })
    ).rejects.toThrow('Write something or attach media to publish');
    await expect(
      publishTorqPost({
        text: 'x',
        userName: 'Alice',
        images: Array.from({ length: TORQ_MAX_IMAGES + 1 }, () => ({
          file: photo(),
        })),
      })
    ).rejects.toThrow('Maximum 10 images per post');
    await expect(publishTorqPost({ text: 'x', userName: ' ' })).rejects.toThrow(
      'A Qortal name is required to publish'
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stops before the approval dialog once cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      publishTorqPost({ text: 'hi', userName: 'Alice', signal: abort.signal })
    ).rejects.toBeInstanceOf(QuitterPublishCancelledError);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('treats a declined approval as a cancel', async () => {
    sendMessage.mockResolvedValue({
      error: 'User declined request',
      message: 'User declined request',
    });
    await expect(
      publishTorqPost({ text: 'hi', userName: 'Alice' })
    ).rejects.toBeInstanceOf(QuitterPublishCancelledError);
  });
});
