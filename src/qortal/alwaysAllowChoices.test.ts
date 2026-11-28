import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SESSION_PERMISSIONS_NOT_READ,
  alwaysAllowChoiceOf,
  isChoiceForApp,
  storedChoices,
} from './alwaysAllowChoices';

describe('the "always allow" boxes, read back from their keys', () => {
  it('reads each box with its app, and the coin of a wallet look-up', () => {
    expect(alwaysAllowChoiceOf('qAPPAutoAuth-Opened-App')).toEqual({
      kind: 'sign_in',
      key: 'qAPPAutoAuth-Opened-App',
      app: 'Opened-App',
      coin: null,
    });
    expect(alwaysAllowChoiceOf('qAPPSendChatMessage-Opened-App')).toMatchObject(
      { kind: 'chat', app: 'Opened-App', coin: null }
    );
    expect(
      alwaysAllowChoiceOf('qAPPAutoGetUserWallet-Opened-App-BTC')
    ).toMatchObject({ kind: 'wallet', app: 'Opened-App', coin: 'BTC' });
    expect(
      alwaysAllowChoiceOf('qAPPAutoWalletBalance-Opened-App-LTC')
    ).toMatchObject({ kind: 'balance', app: 'Opened-App', coin: 'LTC' });
    expect(
      alwaysAllowChoiceOf('getUserWalletInfo-Opened-App-DOGE')
    ).toMatchObject({ kind: 'wallet_info', app: 'Opened-App', coin: 'DOGE' });
    expect(
      alwaysAllowChoiceOf('getUserWalletTransactions-Opened-App-ARRR')
    ).toMatchObject({ kind: 'transactions', app: 'Opened-App', coin: 'ARRR' });
  });

  it('reads the lists box as covering every app', () => {
    expect(alwaysAllowChoiceOf('qAPPAutoLists')).toEqual({
      kind: 'lists',
      key: 'qAPPAutoLists',
      app: null,
      coin: null,
    });
  });

  it("isn't fooled by keys that aren't one of the boxes", () => {
    for (const key of [
      'qAPPAutoAuth-',
      'qAPPAutoWalletBalance-BTC',
      'qAPPAutoWalletBalance-Opened-App-',
      'qAPPAutoListsExtra',
      'qAPPNotification-Qaddress:opened-app',
      'something-else',
      '',
      // Coins that don't look like one can't be told apart from the name.
      'qAPPAutoWalletBalance-Opened-App-B TC',
      'qAPPAutoWalletBalance-Opened-App-SOMETHINGLONG',
      'getUserWalletInfo-Opened-App-BTC\u202E',
    ]) {
      expect(alwaysAllowChoiceOf(key)).toBeNull();
    }
    expect(alwaysAllowChoiceOf(undefined)).toBeNull();
  });

  it('lists the boxes by app, then in the order of the panel', () => {
    const choices = storedChoices([
      { key: 'qAPPAutoWalletBalance-Opened-App-BTC', value: true },
      { key: 'qAPPAutoAuth-Opened-App', value: true },
      { key: 'qAPPSendChatMessage-Opened-App', value: false },
      { key: 'qAPPAutoAuth-Another-App', value: true },
      { key: 'qAPPAutoLists', value: true },
      { key: 'not-a-box', value: true },
    ]);
    expect(choices.map((c) => [c.app, c.kind, c.on])).toEqual([
      [null, 'lists', true],
      ['Another-App', 'sign_in', true],
      ['Opened-App', 'sign_in', true],
      ['Opened-App', 'chat', false],
      ['Opened-App', 'balance', true],
    ]);
  });

  it('keeps the boxes turned off too, as off, and nothing that is not a yes or a no', () => {
    const choices = storedChoices([
      { key: 'qAPPAutoAuth-Opened-App', value: false },
      { key: 'qAPPAutoWalletBalance-Opened-App-BTC', value: true },
      { key: 'qAPPSendChatMessage-Opened-App', value: 'yes' },
      { key: 'qAPPAutoLists', value: null },
    ]);
    expect(choices.map((c) => [c.app, c.kind, c.on])).toEqual([
      ['Opened-App', 'sign_in', false],
      ['Opened-App', 'balance', true],
    ]);
  });

  it('matches an app name in any case, and never the every-app box', () => {
    const signIn = alwaysAllowChoiceOf('qAPPAutoAuth-Opened-App');
    expect(isChoiceForApp(signIn, 'opened-app')).toBe(true);
    expect(isChoiceForApp(signIn, 'Opened-App-2')).toBe(false);
    expect(isChoiceForApp(alwaysAllowChoiceOf('qAPPAutoLists'), '')).toBe(
      false
    );
  });
});

describe('the session permissions the panel leaves out', () => {
  // Read from the handlers' source, so a handler that starts or stops reading
  // a session permission can't leave the panel listing it wrongly.
  const source = (file: string) =>
    readFileSync(resolve(__dirname, file), 'utf8');
  const valid = [
    ...source('qortal-requests.ts')
      .match(/export const VALID_SESSION_PERMISSIONS = \[([^\]]*)\]/)[1]
      .matchAll(/'([A-Z_]+)'/g),
  ].map((match) => match[1]);
  const read = new Set(
    [
      'get.ts',
      'qapp-moq-request.ts',
      'qapp-private-channel-request.ts',
    ].flatMap((file) =>
      [
        ...source(file).matchAll(
          /(?:hasSessionPermission\(\s*[^,]+,\s*[^,]+,|alreadyAllowed\(\s*appInfo,)\s*'([A-Z_]+)'/g
        ),
      ].map((match) => match[1])
    )
  );

  it('are exactly the ones Hub grants and no request reads', () => {
    expect(valid.length).toBeGreaterThan(20);
    expect(valid.filter((permission) => !read.has(permission))).toEqual(
      valid.filter((permission) => SESSION_PERMISSIONS_NOT_READ.has(permission))
    );
    for (const permission of SESSION_PERMISSIONS_NOT_READ) {
      expect(valid).toContain(permission);
    }
  });
});
