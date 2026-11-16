import { describe, expect, it, vi } from 'vitest';
import {
  MockIpcRenderer,
  MockWebContents,
} from '../../src/test/mocks/electron';
import {
  installTabShortcuts,
  resolveTabShortcut,
  subscribeTabShortcuts,
  TAB_SHORTCUT_CHANNEL,
  type TabShortcutAction,
  type TabShortcutKey,
} from './tab-shortcuts';

const press = (key: string, code: string, modifiers = {}): TabShortcutKey => ({
  alt: false,
  code,
  control: false,
  isAutoRepeat: false,
  isComposing: false,
  key,
  meta: false,
  shift: false,
  type: 'keyDown',
  ...modifiers,
});
const ctrl = (key: string, code: string, modifiers = {}) =>
  press(key, code, { control: true, ...modifiers });
const cmd = (key: string, code: string, modifiers = {}) =>
  press(key, code, { meta: true, ...modifiers });

const actionOn = (platform: string, input: TabShortcutKey) =>
  resolveTabShortcut(input, platform)?.action ?? null;

describe('resolveTabShortcut', () => {
  it.each(['linux', 'win32'])('maps the browser shortcuts on %s', (os) => {
    const expected: Array<[TabShortcutKey, TabShortcutAction]> = [
      [ctrl('t', 'KeyT'), { type: 'newTab' }],
      [ctrl('w', 'KeyW'), { type: 'closeTab' }],
      [ctrl('T', 'KeyT', { shift: true }), { type: 'reopenClosedTab' }],
      [ctrl('Tab', 'Tab'), { type: 'nextTab' }],
      [ctrl('Tab', 'Tab', { shift: true }), { type: 'previousTab' }],
      [ctrl('PageDown', 'PageDown'), { type: 'nextTab' }],
      [ctrl('PageUp', 'PageUp'), { type: 'previousTab' }],
      [ctrl('1', 'Digit1'), { type: 'selectTab', index: 0 }],
      [ctrl('8', 'Digit8'), { type: 'selectTab', index: 7 }],
      [ctrl('9', 'Digit9'), { type: 'selectLastTab' }],
      [ctrl('l', 'KeyL'), { type: 'focusSearch' }],
      [ctrl('r', 'KeyR'), { type: 'reloadTab' }],
      [press('F5', 'F5'), { type: 'reloadTab' }],
    ];
    for (const [input, action] of expected) {
      expect(actionOn(os, input)).toEqual(action);
    }
  });

  it('uses Cmd on macOS, but Ctrl to switch tabs, as browsers there do', () => {
    expect(actionOn('darwin', cmd('t', 'KeyT'))).toEqual({ type: 'newTab' });
    expect(actionOn('darwin', cmd('w', 'KeyW'))).toEqual({ type: 'closeTab' });
    expect(actionOn('darwin', cmd('t', 'KeyT', { shift: true }))).toEqual({
      type: 'reopenClosedTab',
    });
    expect(actionOn('darwin', cmd('2', 'Digit2'))).toEqual({
      type: 'selectTab',
      index: 1,
    });
    expect(actionOn('darwin', cmd('9', 'Digit9'))).toEqual({
      type: 'selectLastTab',
    });
    expect(actionOn('darwin', cmd('l', 'KeyL'))).toEqual({
      type: 'focusSearch',
    });
    expect(actionOn('darwin', cmd('r', 'KeyR'))).toEqual({
      type: 'reloadTab',
    });
    expect(actionOn('darwin', ctrl('Tab', 'Tab'))).toEqual({
      type: 'nextTab',
    });
    expect(actionOn('darwin', ctrl('Tab', 'Tab', { shift: true }))).toEqual({
      type: 'previousTab',
    });
    expect(actionOn('darwin', ctrl('PageUp', 'PageUp'))).toEqual({
      type: 'previousTab',
    });

    // Ctrl+letter edits text on macOS; Cmd+Tab and Cmd+PageDown aren't ours.
    for (const input of [
      ctrl('t', 'KeyT'),
      ctrl('w', 'KeyW'),
      ctrl('l', 'KeyL'),
      ctrl('r', 'KeyR'),
      ctrl('1', 'Digit1'),
      cmd('Tab', 'Tab'),
      cmd('PageDown', 'PageDown'),
      cmd('t', 'KeyT', { control: true }),
    ]) {
      expect(actionOn('darwin', input)).toBeNull();
    }
  });

  it('leaves every other key to the page', () => {
    for (const input of [
      ctrl('c', 'KeyC'),
      ctrl('v', 'KeyV'),
      ctrl('f', 'KeyF'),
      ctrl('a', 'KeyA'),
      ctrl('z', 'KeyZ'),
      ctrl('0', 'Digit0'),
      ctrl('Enter', 'Enter'),
      ctrl('ArrowLeft', 'ArrowLeft'),
      press('t', 'KeyT'),
      press('w', 'KeyW'),
      press('Tab', 'Tab'),
      press('T', 'KeyT', { shift: true }),
      press('F6', 'F6'),
      // The View menu's Force Reload keeps Ctrl+Shift+R.
      ctrl('R', 'KeyR', { shift: true }),
      ctrl('W', 'KeyW', { shift: true }),
      ctrl('L', 'KeyL', { shift: true }),
      ctrl('!', 'Digit1', { shift: true }),
      ctrl('PageDown', 'PageDown', { shift: true }),
      ctrl('F5', 'F5'),
      press('F5', 'F5', { shift: true }),
    ]) {
      expect(actionOn('linux', input)).toBeNull();
    }
  });

  it('takes no chord with Alt or with both Ctrl and Meta', () => {
    for (const input of [
      // AltGr arrives as Ctrl+Alt on Windows: AltGr+7 types "{" in German.
      ctrl('{', 'Digit7', { alt: true }),
      ctrl('w', 'KeyW', { alt: true }),
      ctrl('Tab', 'Tab', { alt: true }),
      press('F5', 'F5', { alt: true }),
      press('w', 'KeyW', { meta: true }),
      ctrl('t', 'KeyT', { meta: true }),
      ctrl('Tab', 'Tab', { meta: true }),
    ]) {
      expect(actionOn('win32', input)).toBeNull();
    }
  });

  it('follows the keyboard layout', () => {
    // AZERTY: the digit row types symbols, and W is where Z is on QWERTY.
    expect(actionOn('linux', ctrl('&', 'Digit1'))).toEqual({
      type: 'selectTab',
      index: 0,
    });
    expect(actionOn('linux', ctrl('w', 'KeyZ'))).toEqual({ type: 'closeTab' });
    expect(actionOn('linux', ctrl('z', 'KeyW'))).toBeNull();
    // Dvorak: the W key of a US keyboard types a comma.
    expect(actionOn('linux', ctrl('w', 'Comma'))).toEqual({
      type: 'closeTab',
    });
    expect(actionOn('linux', ctrl(',', 'KeyW'))).toBeNull();
    // Without Latin letters, the key's place counts.
    expect(actionOn('linux', ctrl('ц', 'KeyW'))).toEqual({ type: 'closeTab' });
    expect(actionOn('linux', ctrl('е', 'KeyT'))).toEqual({ type: 'newTab' });
  });

  it('reads keypad digits only with Num Lock on', () => {
    expect(actionOn('linux', ctrl('3', 'Numpad3'))).toEqual({
      type: 'selectTab',
      index: 2,
    });
    expect(actionOn('linux', ctrl('End', 'Numpad1'))).toBeNull();
    expect(actionOn('linux', ctrl('PageDown', 'Numpad3'))).toEqual({
      type: 'nextTab',
    });
  });

  it('acts once per press for new, close, reopen and reload', () => {
    const held = { isAutoRepeat: true };
    for (const input of [
      ctrl('t', 'KeyT', held),
      ctrl('w', 'KeyW', held),
      ctrl('T', 'KeyT', { ...held, shift: true }),
      ctrl('r', 'KeyR', held),
      press('F5', 'F5', held),
    ]) {
      // Still the Hub's key, so the repeat neither reaches the page nor
      // reloads the Hub through the View menu.
      expect(resolveTabShortcut(input, 'linux')).toMatchObject({ run: false });
    }
    for (const input of [
      ctrl('Tab', 'Tab', held),
      ctrl('PageDown', 'PageDown', held),
      ctrl('2', 'Digit2', held),
      ctrl('l', 'KeyL', held),
    ]) {
      expect(resolveTabShortcut(input, 'linux')).toMatchObject({ run: true });
    }
    expect(resolveTabShortcut(ctrl('w', 'KeyW'), 'linux')).toMatchObject({
      run: true,
    });
  });

  it('ignores key-up and keys an input method is composing', () => {
    expect(actionOn('linux', ctrl('w', 'KeyW', { type: 'keyUp' }))).toBeNull();
    expect(
      actionOn('linux', ctrl('w', 'KeyW', { isComposing: true }))
    ).toBeNull();
  });
});

describe('installTabShortcuts', () => {
  const setup = () => {
    const hub = new MockWebContents();
    const guest = new MockWebContents();
    installTabShortcuts(hub, () => hub, 'linux');
    installTabShortcuts(guest, () => hub, 'linux');
    const type = (source: MockWebContents, input: TabShortcutKey) => {
      const event = { preventDefault: vi.fn() };
      source.emit('before-input-event', event, input);
      return event.preventDefault;
    };
    return { guest, hub, type };
  };

  it('hands a shortcut typed in the Hub page to the Hub page', () => {
    const { hub, type } = setup();

    expect(type(hub, ctrl('w', 'KeyW'))).toHaveBeenCalled();
    expect(hub.sent).toEqual([
      { args: [{ type: 'closeTab' }], channel: TAB_SHORTCUT_CHANNEL },
    ]);
  });

  it('hands a shortcut typed in a Q-App to the Hub page', () => {
    const { guest, hub, type } = setup();

    expect(type(guest, ctrl('2', 'Digit2'))).toHaveBeenCalled();
    expect(hub.sent).toEqual([
      {
        args: [{ type: 'selectTab', index: 1 }],
        channel: TAB_SHORTCUT_CHANNEL,
      },
    ]);
    expect(guest.sent).toEqual([]);
    expect(hub.focusCount).toBe(0);
  });

  it('gives the Hub page focus before Ctrl+L from a Q-App', () => {
    const { guest, hub, type } = setup();
    const focus = vi.spyOn(hub, 'focus');
    const send = vi.spyOn(hub, 'send');

    type(guest, ctrl('l', 'KeyL'));

    expect(focus).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(TAB_SHORTCUT_CHANNEL, {
      type: 'focusSearch',
    });
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0]
    );

    type(hub, ctrl('l', 'KeyL'));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('swallows a held key’s repeats without acting on them', () => {
    const { guest, hub, type } = setup();

    expect(
      type(guest, ctrl('w', 'KeyW', { isAutoRepeat: true }))
    ).toHaveBeenCalled();
    expect(
      type(hub, ctrl('r', 'KeyR', { isAutoRepeat: true }))
    ).toHaveBeenCalled();
    expect(hub.sent).toEqual([]);
  });

  it('leaves other keys alone', () => {
    const { guest, hub, type } = setup();

    expect(type(guest, ctrl('c', 'KeyC'))).not.toHaveBeenCalled();
    expect(type(hub, press('w', 'KeyW'))).not.toHaveBeenCalled();
    expect(
      type(hub, ctrl('w', 'KeyW', { type: 'keyUp' }))
    ).not.toHaveBeenCalled();
    expect(hub.sent).toEqual([]);
  });

  it('drops the shortcut when the Hub page is gone or reloading', () => {
    const guest = new MockWebContents();
    let hub: MockWebContents | null = null;
    installTabShortcuts(guest, () => hub, 'linux');
    const event = { preventDefault: vi.fn() };

    guest.emit('before-input-event', event, ctrl('t', 'KeyT'));
    expect(event.preventDefault).toHaveBeenCalled();

    hub = new MockWebContents();
    hub.destroyed = true;
    guest.emit('before-input-event', event, ctrl('t', 'KeyT'));
    expect(hub.sent).toEqual([]);

    hub.destroyed = false;
    vi.spyOn(hub, 'send').mockImplementation(() => {
      throw new Error(
        'Render frame was disposed before WebFrameMain could be accessed'
      );
    });
    expect(() =>
      guest.emit('before-input-event', event, ctrl('t', 'KeyT'))
    ).not.toThrow();
  });
});

describe('subscribeTabShortcuts', () => {
  it('passes on each action until unsubscribed', () => {
    const ipc = new MockIpcRenderer();
    const heard: TabShortcutAction[] = [];

    const unsubscribe = subscribeTabShortcuts(ipc, (action) =>
      heard.push(action)
    );
    ipc.deliver(TAB_SHORTCUT_CHANNEL, { type: 'nextTab' });
    ipc.deliver('some:other-channel', { type: 'closeTab' });
    expect(heard).toEqual([{ type: 'nextTab' }]);

    unsubscribe();
    expect(ipc.listenerCount(TAB_SHORTCUT_CHANNEL)).toBe(0);
    ipc.deliver(TAB_SHORTCUT_CHANNEL, { type: 'closeTab' });
    expect(heard).toEqual([{ type: 'nextTab' }]);
  });
});
