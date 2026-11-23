/**
 * Remove's fee against a balance the node can't check: as a publish sends
 * nothing then ('fee-unknown'), Remove doesn't either.
 */
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://localhost:12391',
}));
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import { VideoPublishError } from '../../lib/videoPublisher/errors';
import { lightTheme } from '../../styles/theme-light';
import {
  createFakeVideoTool,
  type FakeVideoTool,
} from '../../test/mocks/videoTool';
import { publishedHistoryKey } from './publishedHistory';
import {
  setVideoPublisherControllerForTests,
  VideoPublisherController,
} from './videoPublisherController';
import { VideoPublisher } from './VideoPublisher';

const WEBP = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
const ADDRESS = 'Qaddress';
const VIDEO = 'qtube_vid_trip_abc123';
const METADATA = `${VIDEO}_metadata`;

let tool: FakeVideoTool;
let store: ReturnType<typeof createStore>;

beforeEach(() => {
  tool = createFakeVideoTool();
  window.videoTool = tool;
  store = createStore();
  window.localStorage.clear();
});

afterEach(() => {
  setVideoPublisherControllerForTests(null);
  delete window.videoTool;
});

describe("Remove when the node can't list the account's unconfirmed transactions", () => {
  it('is not confirmed with a balance nobody checked', async () => {
    window.localStorage.setItem(
      publishedHistoryKey(ADDRESS),
      JSON.stringify([
        {
          id: 'item:1',
          kind: 'qtube',
          publishedAt: Date.now() - 60_000,
          record: {
            app: 'qtube',
            name: 'Tester',
            title: 'Trip',
            link: `qortal://APP/Q-Tube/video/Tester/${METADATA}`,
            open: {
              service: 'APP',
              name: 'Q-Tube',
              path: `/video/Tester/${METADATA}`,
            },
            resources: [
              {
                service: 'VIDEO',
                name: 'Tester',
                identifier: VIDEO,
                kind: 'video',
                filename: 'Trip.mp4',
              },
              {
                service: 'DOCUMENT',
                name: 'Tester',
                identifier: METADATA,
                kind: 'metadata',
                filename: 'video_metadata.json',
              },
            ],
          },
        },
      ])
    );
    store.set(userInfoAtom, {
      address: ADDRESS,
      name: 'Tester',
      publicKey: 'pubkey',
    });
    const runPublishSteps = vi.fn(async () => ({ ok: true, outcomes: [] }));
    setVideoPublisherControllerForTests(
      new VideoPublisherController({
        store,
        bridge: () => tool,
        isPublicNode: async () => false,
        makeCover: vi.fn(async () => WEBP),
        makeExtracts: vi.fn(async (frames) => frames.map(() => WEBP)),
        makeQshareThumbnail: vi.fn(async () => WEBP),
        waitForPublishSlot: vi.fn(async () => true),
        requestApproval: vi.fn(async () => true),
        estimatePublishFee: vi.fn(async (count) => ({
          unitFee: 0.01,
          count: Number(count),
          total: Math.round(Number(count) * 1e6) / 1e8,
        })),
        // What runner.checkPublishBalance does when the node can't list
        // them: no answer, never "nothing pending".
        checkPublishBalance: vi.fn(async () => {
          throw new VideoPublishError('network', 'unconfirmed');
        }),
        runPublishSteps,
      })
    );
    render(
      <Provider store={store}>
        <ThemeProvider theme={lightTheme}>
          <VideoPublisher />
        </ThemeProvider>
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Published (1)' }));
    const list = screen.getByRole('region', { name: 'Published videos' });
    const row = within(list).getByRole('listitem', { name: 'Trip' });
    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    const remove = await screen.findByRole('dialog', {
      name: 'Remove “Trip” from Q-Tube?',
    });
    await within(remove).findByText(/^Fee: |Couldn't get the fee/);

    expect(
      within(remove).getByRole('button', { name: 'Remove from Q-Tube' })
    ).toBeDisabled();
  });
});
