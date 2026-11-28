import { afterEach, describe, expect, it } from 'vitest';
import {
  FILE_SAVE_IDLE_MS,
  forgetTabActivity,
  isTabBusy,
  noteTabFileSave,
  noteTabPageGone,
  trackTabRequest,
} from './tabActivity';

/** A request Hub answers when the test says so. */
const pendingRequest = () => {
  let answer: (value: string) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const request = new Promise<string>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { answer, fail, request };
};

const TAB = 'tab-a';
const OTHER = 'tab-b';

afterEach(() => {
  forgetTabActivity(TAB);
  forgetTabActivity(OTHER);
  forgetTabActivity('7');
});

describe('tab activity: requests', () => {
  it('counts a request as waiting until it is answered', async () => {
    const { answer, request } = pendingRequest();

    expect(trackTabRequest(TAB, request)).toBe(request);
    expect(isTabBusy(TAB)).toBe(true);
    expect(isTabBusy(OTHER)).toBe(false);

    answer('done');
    await request;
    expect(isTabBusy(TAB)).toBe(false);
  });

  it('counts a failed request as answered, and leaves its failure to the caller', async () => {
    const { fail, request } = pendingRequest();
    trackTabRequest(TAB, request);

    fail(new Error('declined'));
    await expect(request).rejects.toThrow('declined');
    expect(isTabBusy(TAB)).toBe(false);
  });

  it('waits for every request of the tab', async () => {
    const first = pendingRequest();
    const second = pendingRequest();
    trackTabRequest(TAB, first.request);
    trackTabRequest(TAB, second.request);

    first.answer('one');
    await first.request;
    expect(isTabBusy(TAB)).toBe(true);

    second.answer('two');
    await second.request;
    expect(isTabBusy(TAB)).toBe(false);
  });

  it('takes a numeric tab id as the same tab as its text', async () => {
    const { answer, request } = pendingRequest();
    trackTabRequest(7, request);
    expect(isTabBusy('7')).toBe(true);
    answer('done');
    await request;
    expect(isTabBusy(7)).toBe(false);
  });

  it('forgets a closed tab, and an answer after that changes nothing', async () => {
    const { answer, request } = pendingRequest();
    trackTabRequest(TAB, request);
    forgetTabActivity(TAB);
    expect(isTabBusy(TAB)).toBe(false);

    // A new request of a tab with the same id is its own.
    const later = pendingRequest();
    trackTabRequest(TAB, later.request);
    answer('late');
    await request;
    expect(isTabBusy(TAB)).toBe(true);
  });

  it('ignores a request without a tab', () => {
    const { request } = pendingRequest();
    expect(trackTabRequest(undefined, request)).toBe(request);
    expect(trackTabRequest('', request)).toBe(request);
    expect(isTabBusy(undefined)).toBe(false);
    expect(isTabBusy('')).toBe(false);
  });
});

describe('tab activity: file saves', () => {
  it('keeps a save open from its id until it is finished', () => {
    noteTabFileSave(TAB, 'save-1', 'open', 1_000);
    expect(isTabBusy(TAB, 1_000)).toBe(true);

    noteTabFileSave(TAB, 'save-1', 'done');
    expect(isTabBusy(TAB, 1_000)).toBe(false);
  });

  it('lets a save go once nothing was written to it for as long as Hub keeps one', () => {
    noteTabFileSave(TAB, 'save-1', 'open', 0);
    expect(isTabBusy(TAB, FILE_SAVE_IDLE_MS)).toBe(true);
    expect(isTabBusy(TAB, FILE_SAVE_IDLE_MS + 1)).toBe(false);

    noteTabFileSave(TAB, 'save-1', 'write', FILE_SAVE_IDLE_MS);
    expect(isTabBusy(TAB, FILE_SAVE_IDLE_MS + 1)).toBe(true);
  });

  it('keeps each save of the tab apart', () => {
    noteTabFileSave(TAB, 'save-1', 'open', 0);
    noteTabFileSave(TAB, 'save-2', 'open', 0);
    noteTabFileSave(TAB, 'save-1', 'done');
    expect(isTabBusy(TAB, 0)).toBe(true);
    noteTabFileSave(TAB, 'save-2', 'done');
    expect(isTabBusy(TAB, 0)).toBe(false);
  });

  it('ignores a step without a save id', () => {
    noteTabFileSave(TAB, undefined, 'open', 0);
    noteTabFileSave(TAB, '', 'open', 0);
    expect(isTabBusy(TAB, 0)).toBe(false);
  });
});

describe('tab activity: the page going', () => {
  it('drops every save, which Hub ends with the page', () => {
    noteTabFileSave(TAB, 'save-1', 'open', 0);
    noteTabPageGone(TAB);
    expect(isTabBusy(TAB, 0)).toBe(false);
  });

  it('keeps a request counted until it is answered', () => {
    const { request } = pendingRequest();
    trackTabRequest(TAB, request);
    noteTabFileSave(TAB, 'save-1', 'open');
    noteTabPageGone(TAB);
    expect(isTabBusy(TAB)).toBe(true);
  });

  it('leaves the other tabs as they are', () => {
    noteTabFileSave(OTHER, 'save-1', 'open');
    noteTabPageGone(TAB);
    expect(isTabBusy(OTHER)).toBe(true);
  });
});
