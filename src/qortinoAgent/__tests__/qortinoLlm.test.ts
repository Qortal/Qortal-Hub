import { afterEach, describe, expect, it } from 'vitest';
import QortinoLlm, { unwrapIpcError } from '../qortinoLlm';

describe("Qortino's bridge to the desktop app", () => {
  afterEach(() => {
    delete window.qortinoLlm;
  });

  it("gives back the handler's own message, as Electron wraps it", () => {
    expect(
      unwrapIpcError(
        new Error(
          "Error invoking remote method 'qortino:complete': Error: cancelled"
        )
      ).message
    ).toBe('cancelled');
    expect(
      unwrapIpcError(
        new Error(
          "Error invoking remote method 'qortino:complete': Error: Model is not loaded"
        )
      ).message
    ).toBe('Model is not loaded');
    expect(
      unwrapIpcError(
        new Error("Error invoking remote method 'qortino:x': TypeError: bad")
      ).message
    ).toBe('bad');
    expect(unwrapIpcError(new Error('plain')).message).toBe('plain');
    expect(unwrapIpcError('text').message).toBe('text');
  });

  it('unwraps every call of the bridge', async () => {
    window.qortinoLlm = {
      complete: async () => {
        throw new Error(
          "Error invoking remote method 'qortino:complete': Error: cancelled"
        );
      },
      on: () => () => undefined,
    } as unknown as typeof window.qortinoLlm;
    await expect(QortinoLlm.complete({ messages: [] })).rejects.toThrow(
      /^cancelled$/
    );
  });

  it('is not there in the browser build', async () => {
    expect(await QortinoLlm.fileExists({ relativePath: 'models/x' })).toEqual({
      exists: false,
      path: '',
      size: 0,
    });
    await expect(QortinoLlm.complete({ messages: [] })).rejects.toThrow(
      'desktop app'
    );
  });
});
