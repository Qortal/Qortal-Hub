/**
 * Finishing a Remove that stopped half way, from the published list: the
 * fee it asks for against what is left to replace.
 */
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The apps' pictures come from the node, as everywhere in Hub.
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://localhost:12391',
}));
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
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

describe('Remove from the published list, after one that stopped half way', () => {
  it('asks only for the fee of what is left to replace', async () => {
    // Hub closed while a Remove went: the listing was replaced, the video
    // not yet. The balance covers the one replacement left, not two.
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
          removal: 'removing',
          removedKeys: [`remove:DOCUMENT:${METADATA}`],
        },
      ])
    );
    store.set(userInfoAtom, {
      address: ADDRESS,
      name: 'Tester',
      publicKey: 'pubkey',
    });
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
        checkPublishBalance: vi.fn(async (_address, needed) => ({
          balance: 0.015,
          enough: 0.015 >= needed,
        })),
        runPublishSteps: vi.fn(async () => ({ ok: true, outcomes: [] })),
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

    // One resource is left: its fee, which the balance covers.
    expect(await within(remove).findByText('Fee: 0.01 QORT')).toBeVisible();
    expect(
      within(remove).queryByText('Not enough QORT for the fee.')
    ).not.toBeInTheDocument();
    expect(
      within(remove).getByRole('button', { name: 'Remove from Q-Tube' })
    ).toBeEnabled();
  });
});

describe('Remove from the published list, right after publishing', () => {
  it("counts the fees of the account's unconfirmed transactions", async () => {
    // 0.03 QORT confirmed, 0.02 of it owed by the publish still
    // unconfirmed. The node checks each replacement against the confirmed
    // balance alone and takes both, but only one of them would confirm.
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
    const checkPublishBalance = vi.fn(
      async (_address: string, needed: number, publicKey?: string | null) => {
        const pending = publicKey === 'pubkey' ? 2 : 0;
        return {
          balance: 0.03,
          enough: 3 - pending >= Math.round(needed * 100),
        };
      }
    );
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
        checkPublishBalance,
        runPublishSteps: vi.fn(async () => ({ ok: true, outcomes: [] })),
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

    expect(await within(remove).findByText('Fee: 0.02 QORT')).toBeVisible();
    expect(
      await within(remove).findByText('Not enough QORT for the fee.')
    ).toBeVisible();
    expect(
      within(remove).getByRole('button', { name: 'Remove from Q-Tube' })
    ).toBeDisabled();
    expect(checkPublishBalance).toHaveBeenCalledWith(ADDRESS, 0.02, 'pubkey');
  });
});
