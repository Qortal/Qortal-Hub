import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProximityVoiceControl } from './ProximityVoiceControl';

const baseProps: React.ComponentProps<typeof ProximityVoiceControl> = {
  state: 'off',
  mode: 'push-to-talk',
  pttKey: 'v',
  transmitting: false,
  peers: [],
  error: '',
  devices: [],
  inputDeviceId: '',
  outputDeviceId: '',
  masterVolume: 0.75,
  resolveName: (address) => address,
  onEnable: vi.fn(async () => {}),
  onDisable: vi.fn(async () => {}),
  onMode: vi.fn(),
  onPttKey: vi.fn(),
  onInputDevice: vi.fn(),
  onOutputDevice: vi.fn(),
  onMasterVolume: vi.fn(),
  onPeerPolicy: vi.fn(),
};

const nearbyPeer = (address: string) => ({
  key: `${address}:session-${address.slice(-1)}`,
  address,
  sessionId: `session-${address.slice(-1)}`,
  sourceId: Number(address.slice(-1)) || 1,
  state: 'connected',
  distance: 120,
  gain: 0.9,
  pan: 0.2,
  audible: true,
  muted: false,
  volume: 1,
  speaking: false,
});

describe('ProximityVoiceControl', () => {
  it('opens the minimal disabled state and enables open-mic voice', async () => {
    const onEnable = vi.fn(async () => {});
    const onMode = vi.fn();
    render(
      <ProximityVoiceControl
        {...baseProps}
        onEnable={onEnable}
        onMode={onMode}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Proximity Voice/ }));
    expect(
      screen.getByRole('dialog', { name: 'Proximity voice' })
    ).toBeTruthy();
    expect(screen.getByText('Voice is off')).toBeTruthy();
    expect(screen.getByText('Nobody nearby')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enable voice' }));
    await waitFor(() => expect(onEnable).toHaveBeenCalledTimes(1));
    expect(onMode).toHaveBeenCalledWith('open-mic');
  });

  it('disconnects on mute and reconnects on unmute', async () => {
    const onDisable = vi.fn(async () => {});
    const onEnable = vi.fn(async () => {});
    render(
      <ProximityVoiceControl
        {...baseProps}
        state="ready"
        mode="open-mic"
        peers={['Qpeer1', 'Qpeer2', 'Qpeer3', 'Qpeer4'].map(nearbyPeer)}
        resolveName={(address) => `Nearby ${address.slice(-1)}`}
        onDisable={onDisable}
        onEnable={onEnable}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Proximity Voice/ }));
    expect(screen.getByText('Talk with players near you.')).toBeTruthy();
    expect(screen.getByText('Nearby 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    await waitFor(() => expect(onDisable).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Voice muted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }));
    await waitFor(() => expect(onEnable).toHaveBeenCalledTimes(1));
  });

  it('shows device and 75% volume settings in the voice panel', async () => {
    render(
      <ProximityVoiceControl {...baseProps} state="ready" mode="open-mic" />
    );

    fireEvent.click(screen.getByRole('button', { name: /Proximity Voice/ }));
    expect(screen.getByText('Output')).toBeTruthy();
    expect(screen.getByText('Microphone')).toBeTruthy();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toHaveTextContent('System default');
    }
    expect(screen.getByText('75%')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Proximity voice' })
      ).toBeNull();
    });
  });
});
