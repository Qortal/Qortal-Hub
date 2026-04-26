import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupCallProvider, useGroupCallContext } from './GroupCallContext';
import type { GroupCallControllerApi } from '../lib/group-call/audioEngineTypes';
import { buildDefaultGroupCallControllerSnapshot } from '../lib/group-call/audioSurfaceBridge';

const defaultSnap = buildDefaultGroupCallControllerSnapshot();
const audioSurfaceController: GroupCallControllerApi = {
  ...defaultSnap,
  joinGroupCall: vi.fn(async () => {}),
  leaveGroupCall: vi.fn(async () => {}),
  clearGcallJoinError: vi.fn(),
  exportGroupCallDiagnostics: vi.fn(async () => null),
  setMuted: vi.fn(),
  setHearCall: vi.fn(),
  toggleHearCall: vi.fn(),
  setAudioQualityProfile: vi.fn(),
};

const { useAudioSurfaceGroupCallControllerMock } = vi.hoisted(() => ({
  useAudioSurfaceGroupCallControllerMock: vi.fn(),
}));

vi.mock('../hooks/useAudioSurfaceGroupCallController', () => ({
  useAudioSurfaceGroupCallController: useAudioSurfaceGroupCallControllerMock,
}));

vi.mock('../hooks/useQortalGroupCallSidebarActivitySync', () => ({
  useQortalGroupCallSidebarActivitySync: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function Probe() {
  const value = useGroupCallContext();
  return <div data-testid="room-state">{value.roomState}</div>;
}

describe('GroupCallProvider', () => {
  beforeEach(() => {
    useAudioSurfaceGroupCallControllerMock.mockReset();
    useAudioSurfaceGroupCallControllerMock.mockReturnValue(
      audioSurfaceController
    );
  });

  afterEach(() => {
    delete (window as Window & { audioSurface?: unknown }).audioSurface;
  });

  it('uses the audio-surface controller when the hidden runtime is available', () => {
    (window as Window & { audioSurface?: unknown }).audioSurface = {};

    render(
      <GroupCallProvider>
        <Probe />
      </GroupCallProvider>
    );

    expect(screen.getByTestId('room-state')).toHaveTextContent('idle');
    expect(useAudioSurfaceGroupCallControllerMock).toHaveBeenCalled();
  });

  it('uses a no-op controller when audio surface is unavailable (no legacy hook)', () => {
    render(
      <GroupCallProvider>
        <Probe />
      </GroupCallProvider>
    );

    expect(screen.getByTestId('room-state')).toHaveTextContent('idle');
    expect(useAudioSurfaceGroupCallControllerMock).not.toHaveBeenCalled();
  });
});
