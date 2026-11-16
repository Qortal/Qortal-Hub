// MessageDisplay.test.ts
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { extractComponents, MessageDisplay } from './MessageDisplay';

describe('extractComponents', () => {
  // sanity checks
  it('returns null for falsy or non-qortal URLs', () => {
    expect(extractComponents('')).toBeNull();
    expect(extractComponents(null as unknown as string)).toBeNull();
    expect(extractComponents('https://example.com')).toBeNull();
  });

  it('returns null for qortal://use-* links', () => {
    expect(extractComponents('qortal://use-tool')).toBeNull();
    expect(extractComponents('qortal://use-')).toBeNull();
  });

  it('parses service-based URLs with a slash', () => {
    const res = extractComponents('qortal://blog/alice/my-post');
    expect(res).toEqual({
      service: 'BLOG',
      name: 'alice',
      identifier: undefined,
      path: 'my-post',
    });
  });

  it('defaults qortal://<username> to WEBSITE service', () => {
    const res = extractComponents('qortal://alice');
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'alice',
      identifier: undefined,
      path: '',
    });
  });

  it('leaves explicit WEBSITE service intact', () => {
    const res = extractComponents('qortal://WEBSITE/bob');
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'bob',
      identifier: undefined,
      path: '',
    });
  });

  it('uppercases the service portion only', () => {
    const res = extractComponents('qortal://weBsiTe/CaseUser');
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'CaseUser',
      identifier: undefined,
      path: '',
    });
  });

  it('reads the protocol in any case', () => {
    expect(extractComponents('QORTAL://APP/Q-Tube')).toEqual({
      service: 'APP',
      name: 'Q-Tube',
      identifier: undefined,
      path: '',
    });
    expect(extractComponents('Qortal://website/name')).toEqual({
      service: 'WEBSITE',
      name: 'name',
      identifier: undefined,
      path: '',
    });
    expect(
      extractComponents('qOrTaL://app/Q-Blog/post/1?identifier=abc&x=1')
    ).toEqual({
      service: 'APP',
      name: 'Q-Blog',
      identifier: 'abc',
      path: 'post/1?x=1',
    });
    expect(extractComponents('QORTAL://alice')).toEqual({
      service: 'WEBSITE',
      name: 'alice',
      identifier: undefined,
      path: '',
    });
  });

  it('returns null for qortal://use-* links in any case', () => {
    expect(
      extractComponents('QORTAL://USE-GROUP/action-join/groupid-5')
    ).toBeNull();
    expect(extractComponents('Qortal://use-embed/x')).toBeNull();
  });

  // a couple of edge cases
  it('handles just protocol (no content) as null', () => {
    expect(extractComponents('qortal://')).toBeNull();
    expect(extractComponents('QORTAL://')).toBeNull();
  });

  it('handles single-segment non-empty after protocol with spaces', () => {
    const res = extractComponents(
      'qortal://  alice  '.replace('  ', '').replace('  ', '')
    ); // simulate trimmed input
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'alice',
      identifier: undefined,
      path: '',
    });
  });
});

describe('Reticulum privileged mention rendering', () => {
  const everyoneHtml =
    '<p><span class="mention" data-type="mention" data-id="everyone" data-label="everyone">@everyone</span></p>';

  it('renders an unauthorized broadcast token as ordinary text', () => {
    const { container } = render(
      <MessageDisplay
        htmlContent={everyoneHtml}
        privilegedMentionAuthorized={false}
      />
    );

    expect(container.textContent).toContain('@everyone');
    expect(container.querySelector('.mention')).toBeNull();
  });

  it('removes spoofed styling even when a modified sender omits the mention id', () => {
    const { container } = render(
      <MessageDisplay
        htmlContent={
          '<p><span class="mention" data-label="here">@here</span></p>'
        }
        privilegedMentionAuthorized={false}
      />
    );

    expect(container.textContent).toContain('@here');
    expect(container.querySelector('.mention')).toBeNull();
  });

  it('removes spoofed styling when a modified sender supplies a different id', () => {
    const { container } = render(
      <MessageDisplay
        htmlContent={
          '<p><span class="mention" data-type="mention" data-id="ordinary-user">@everyone</span></p>'
        }
        privilegedMentionAuthorized={false}
      />
    );

    expect(container.textContent).toContain('@everyone');
    expect(container.querySelector('.mention')).toBeNull();
  });

  it('preserves mention styling after local authorization', () => {
    const { container } = render(
      <MessageDisplay htmlContent={everyoneHtml} privilegedMentionAuthorized />
    );

    expect(container.querySelector('.mention')?.textContent).toBe('everyone');
  });

  it('renders an authorized label-only mention without the trigger character', () => {
    const { container } = render(
      <MessageDisplay
        htmlContent={
          '<p><span class="mention" data-label="here">@here</span></p>'
        }
        privilegedMentionAuthorized
      />
    );

    expect(container.querySelector('.mention')?.textContent).toBe('here');
  });
});
