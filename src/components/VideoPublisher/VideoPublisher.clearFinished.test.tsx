/**
 * "Clear finished" while a series still holds its episodes that went up
 * (they wait for its playlist, so the list keeps them).
 */
import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { PublishApprovalRequest } from './publishApproval';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://localhost:12391',
}));
import '../../i18n/i18n';
import { userInfoAtom } from '../../atoms/global';
import type {
  PublishStep,
  RunPublishOptions,
  RunPublishResult,
} from '../../lib/videoPublisher';
import { lightTheme } from '../../styles/theme-light';
import {
  createFakeVideoTool,
  type FakeVideoTool,
} from '../../test/mocks/videoTool';
import {
  setVideoPublisherControllerForTests,
  VideoPublisherController,
} from './videoPublisherController';
import { VideoPublisher } from './VideoPublisher';
import {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS,
  videoPublisherSettingsAtom,
} from './videoPublisherAtoms';

const WEBP = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4';
const PREVIEW_FIRST_DEFAULT = VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst;

type Publish = {
  steps: readonly PublishStep[];
  options: RunPublishOptions;
  resolve: (result?: Partial<RunPublishResult>) => void;
};

let tool: FakeVideoTool;
let store: ReturnType<typeof createStore>;
let publishes: Publish[];
let approvals: Mock<(request: PublishApprovalRequest) => Promise<boolean>>;

const file = (name: string, relativePath: string) => {
  const value = new File(['x'], name);
  Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  return value;
};

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

const renderWindow = () => {
  store.set(userInfoAtom, {
    address: 'Qaddress',
    name: 'Tester',
    publicKey: 'pubkey',
  });
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = false;
  store.set(videoPublisherSettingsAtom, {
    ...VIDEO_PUBLISHER_DEFAULT_SETTINGS,
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
      requestApproval: approvals,
      estimatePublishFee: vi.fn(async (count) => ({
        unitFee: 0.01,
        count: Number(count),
        total: Math.round(Number(count) * 1e6) / 1e8,
      })),
      checkPublishBalance: vi.fn(async () => ({ balance: 12.5, enough: true })),
      runPublishSteps: vi.fn(
        (steps, options) =>
          new Promise<RunPublishResult>((resolve) => {
            publishes.push({
              steps,
              options,
              resolve: (result) => {
                const outcomes =
                  result?.outcomes ??
                  steps.map((step) => ({
                    key: step.key,
                    status: 'published' as const,
                  }));
                outcomes.forEach((outcome) => options.onStepDone?.(outcome));
                resolve({ ok: true, ...result, outcomes });
              },
            });
          })
      ),
    })
  );
  return render(
    <Provider store={store}>
      <ThemeProvider theme={lightTheme}>
        <VideoPublisher />
      </ThemeProvider>
    </Provider>
  );
};

const choose = async (label: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

/** Two episodes as a series: the first goes up, then the run goes on. */
const startSeries = async () => {
  renderWindow();
  await act(async () => {
    fireEvent.change(screen.getByTestId('video-publisher-folder'), {
      target: {
        files: [
          file('Show.S01E01.Pilot.mkv', 'Show/Show.S01E01.Pilot.mkv'),
          file('Show.S01E02.Next.mkv', 'Show/Show.S01E02.Next.mkv'),
        ],
      },
    });
  });
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  await choose('Genre', 'Dramas');
  fireEvent.click(
    screen.getByRole('button', { name: 'Convert and publish the series (2)' })
  );
  await settle();
  act(() => tool.finishJob('job-1'));
  await settle();
  await act(async () => publishes[0].resolve());
  await settle();
};

beforeEach(() => {
  tool = createFakeVideoTool();
  window.videoTool = tool;
  store = createStore();
  publishes = [];
  approvals = vi.fn(async () => true);
  window.localStorage.clear();
});

afterEach(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = PREVIEW_FIRST_DEFAULT;
  setVideoPublisherControllerForTests(null);
  delete window.videoTool;
});

/** Clear finished, when it's offered, takes something off the list. */
const expectClearFinishedToDoSomething = async () => {
  const before = screen.getAllByRole('listitem').length;
  const clear = screen.queryByRole('button', { name: 'Clear finished' });
  if (!clear) return;
  expect(clear).toBeEnabled();
  fireEvent.click(clear);
  await settle();
  expect(screen.getAllByRole('listitem').length).toBeLessThan(before);
};

describe('Clear finished while a series holds its episodes', () => {
  it('is not a button that does nothing while the series waits for a failed episode', async () => {
    await startSeries();
    act(() => tool.failJob('job-2', 'ffmpeg-failed'));
    await settle();
    expect(
      screen.getByText("Episodes that didn't go up: 1")
    ).toBeInTheDocument();

    await expectClearFinishedToDoSomething();
  });

  it('is not a button that does nothing after Cancel all stopped the playlist at its approval', async () => {
    await startSeries();
    act(() => tool.finishJob('job-2'));
    await settle();
    // The playlist's approval stays open while Cancel all is pressed.
    let answer: (accepted: boolean) => void = () => undefined;
    approvals.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        })
    );
    await act(async () => publishes[1].resolve());
    await settle();
    expect(approvals).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all' }));
    await settle();
    await act(async () => answer(true));
    await settle();
    const series = screen.getByRole('region', { name: /^Series: / });
    expect(within(series).getByText('Cancelled.')).toBeInTheDocument();
    expect(publishes).toHaveLength(2);

    await expectClearFinishedToDoSomething();

    // Retry asks again and sends the playlist.
    fireEvent.click(within(series).getByRole('button', { name: 'Retry' }));
    await settle();
    expect(approvals).toHaveBeenCalledTimes(4);
    expect(publishes[2].steps.map((step) => step.kind)).toEqual(['playlist']);
  });
});
