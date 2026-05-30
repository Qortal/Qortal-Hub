import { describe, expect, it } from 'vitest';
import { getCallSwitchDropPlan } from './CallSwitchGuardContext';

describe('getCallSwitchDropPlan', () => {
  it('keeps the ringing direct call when switching from a group call to accept it', () => {
    expect(
      getCallSwitchDropPlan({
        target: { type: 'direct', chatId: 'direct:Qme:Qpeer' },
        directState: 'ringing',
        directIncomingChatId: 'direct:Qme:Qpeer',
        groupState: 'connected',
      })
    ).toEqual({
      shouldDropDirect: false,
      shouldDropGroup: true,
    });
  });

  it('drops a ringing direct call when switching to a different target', () => {
    expect(
      getCallSwitchDropPlan({
        target: { type: 'group', roomId: 'gcall-qortal-7' },
        directState: 'ringing',
        directIncomingChatId: 'direct:Qme:Qpeer',
        groupState: 'idle',
      })
    ).toEqual({
      shouldDropDirect: true,
      shouldDropGroup: false,
    });
  });
});
