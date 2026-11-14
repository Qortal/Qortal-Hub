import { act, render, screen, waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { qortinoAgentOpenAtom } from '../../../../atoms/global';

const panel = vi.hoisted(() => ({ fail: false }));
vi.mock('../QortinoAgentPanel', () => ({
  default: () => {
    if (panel.fail) throw new Error('URIError: URI malformed');
    return <div>panel</div>;
  },
}));

import { QortinoAgentHost } from '../QortinoAgentHost';

describe("Qortino's place in Hub", () => {
  afterEach(() => {
    delete window.qortinoLlm;
    panel.fail = false;
    getDefaultStore().set(qortinoAgentOpenAtom, false);
    vi.restoreAllMocks();
  });

  it('keeps a fault in the panel out of the rest of Hub', async () => {
    window.qortinoLlm = {} as typeof window.qortinoLlm;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    panel.fail = true;
    render(
      <div>
        <span>rest of Hub</span>
        <QortinoAgentHost />
      </div>
    );
    await act(async () => {
      getDefaultStore().set(qortinoAgentOpenAtom, true);
    });
    expect(screen.getByText('rest of Hub')).toBeInTheDocument();
    expect(screen.queryByText('panel')).not.toBeInTheDocument();
    // Closed, so the next open request opens it again.
    await waitFor(() =>
      expect(getDefaultStore().get(qortinoAgentOpenAtom)).toBe(false)
    );
    panel.fail = false;
    await act(async () => {
      getDefaultStore().set(qortinoAgentOpenAtom, true);
    });
    expect(await screen.findByText('panel')).toBeInTheDocument();
  });

  it('closes Qortino when the session ends, for the next account', async () => {
    window.qortinoLlm = {} as typeof window.qortinoLlm;
    const { unmount } = render(<QortinoAgentHost />);
    await act(async () => {
      getDefaultStore().set(qortinoAgentOpenAtom, true);
    });
    expect(await screen.findByText('panel')).toBeInTheDocument();
    unmount();
    expect(getDefaultStore().get(qortinoAgentOpenAtom)).toBe(false);
  });

  it('shows nothing in the browser build', async () => {
    render(<QortinoAgentHost />);
    await act(async () => {
      getDefaultStore().set(qortinoAgentOpenAtom, true);
    });
    expect(screen.queryByText('panel')).not.toBeInTheDocument();
  });
});
