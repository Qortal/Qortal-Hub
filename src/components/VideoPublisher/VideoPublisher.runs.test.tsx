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

// The apps' pictures come from the node, as everywhere in Hub.
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://localhost:12391',
}));
// Initialises the shared i18n instance so useTranslation resolves real strings.
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

const file = (name: string, relativePath?: string) => {
  const value = new File(['x'], name);
  if (relativePath) {
    Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  }
  return value;
};

const renderWindow = ({
  previewFirst = false,
}: { previewFirst?: boolean } = {}) => {
  store.set(userInfoAtom, {
    address: 'Qaddress',
    name: 'Tester',
    publicKey: 'pubkey',
  });
  // Through the defaults: a sign-in resets the settings to them.
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = previewFirst;
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

const addVideos = async (...files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('video-publisher-files'), {
      target: { files },
    });
  });
  await waitFor(() =>
    expect(screen.queryByText('Reading the file…')).not.toBeInTheDocument()
  );
};

const card = (name: string | RegExp) => screen.getByRole('listitem', { name });

/** Picks an option of a MUI select by the field's label. */
const choose = async (label: string, option: string, scope = document.body) => {
  fireEvent.mouseDown(within(scope).getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
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

describe('VideoPublisher, the main button', () => {
  it('leaves an unticked video out when the main button is double-clicked', async () => {
    renderWindow();
    await addVideos(file('First.mp4'), file('Second.mp4'));
    await choose('Category', 'Education');
    fireEvent.click(
      within(card('Second')).getByRole('checkbox', {
        name: 'Include Second in the next publish',
      })
    );
    const main = () =>
      screen.getByRole('button', { name: /^Convert and publish to Q-Tube/ });
    expect(main()).toHaveTextContent('(1)');
    // A double click: two clicks, the second one counted as such.
    fireEvent.click(main(), { detail: 1 });
    fireEvent.click(main(), { detail: 2 });
    await settle();
    expect(card('First')).toHaveAttribute('data-phase', 'converting');
    expect(card('Second')).toHaveAttribute('data-phase', 'ready');
    expect(tool.startJob).toHaveBeenCalledTimes(1);
  });
});

describe('VideoPublisher, Remove', () => {
  it('removes once when Remove is confirmed with a double click', async () => {
    renderWindow();
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    fireEvent.click(
      within(card('Trip')).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove “Trip” from Q-Tube?',
    });
    await within(dialog).findByText('Fee: 0.02 QORT');
    const confirm = within(dialog).getByRole('button', {
      name: 'Remove from Q-Tube',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await settle();
    // Both clicks reach the dialog's button (it's there while it closes):
    // the upload, and one removal, its two resources replaced once.
    expect(publishes).toHaveLength(2);
  });

  it('asks only the fee of what is left after a removal stopped half way', async () => {
    renderWindow();
    await act(async () => {
      fireEvent.change(screen.getByTestId('video-publisher-files'), {
        target: { files: [file('Trip.mp4')] },
      });
    });
    await waitFor(() =>
      expect(screen.queryByText('Reading the file…')).not.toBeInTheDocument()
    );
    await choose('Category', 'Travel & Adventure');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    const trip = () => screen.getByRole('listitem', { name: 'Trip' });
    const remove = async () => {
      fireEvent.click(
        within(trip()).getByRole('button', { name: 'Remove from Q-Tube' })
      );
      return screen.findByRole('dialog', {
        name: 'Remove “Trip” from Q-Tube?',
      });
    };
    const first = await remove();
    await within(first).findByText('Fee: 0.02 QORT');
    fireEvent.click(
      within(first).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    await settle();
    // The listing is replaced; the node refuses the VIDEO's replacement.
    const removal = publishes[1];
    const refused = { code: 'refused' } as never;
    await act(async () =>
      removal.resolve({
        ok: false,
        stoppedBy: refused,
        outcomes: [
          { key: removal.steps[0].key, status: 'published' },
          { key: removal.steps[1].key, status: 'failed', error: refused },
        ],
      })
    );
    await settle();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );

    // Remove again: one resource is left, one fee.
    const second = await remove();
    expect(await within(second).findByText(/^Fee: /)).toHaveTextContent(
      'Fee: 0.01 QORT'
    );
  });
});

describe('VideoPublisher, a title that no longer fits', () => {
  it('holds Publish it while the title is longer than the app takes', async () => {
    renderWindow({ previewFirst: true });
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert for Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    // Checked, and its title made longer than Q-Tube takes.
    fireEvent.change(
      within(card('Trip')).getByRole('textbox', { name: 'Title' }),
      { target: { value: 'x'.repeat(200) } }
    );
    const waiting = card(/^x+$/);
    expect(
      within(waiting).getByText('Still needs a shorter title.')
    ).toBeInTheDocument();
    fireEvent.click(
      within(waiting).getByRole('button', { name: 'Publish it' })
    );
    await settle();
    // Not cut and sent: it waits until the title fits.
    expect(approvals).not.toHaveBeenCalled();
    expect(publishes).toHaveLength(0);
    fireEvent.change(
      within(card(/^x+$/)).getByRole('textbox', { name: 'Title' }),
      { target: { value: 'Trip' } }
    );
    fireEvent.click(
      within(card('Trip')).getByRole('button', { name: 'Publish it' })
    );
    await settle();
    expect(publishes).toHaveLength(1);
  });

  it('does not cut and send a title made too long while its video converts', async () => {
    renderWindow();
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    fireEvent.change(
      within(card('Trip')).getByRole('textbox', { name: 'Title' }),
      { target: { value: 'x'.repeat(200) } }
    );
    act(() => tool.finishJob('job-1'));
    await settle();
    expect(approvals).not.toHaveBeenCalled();
    expect(publishes).toHaveLength(0);
    // It waits with what it needs said; shortened, it goes on the user's word.
    const waiting = card(/^x+$/);
    expect(
      within(waiting).getByText('Still needs a shorter title.')
    ).toBeInTheDocument();
    fireEvent.change(within(waiting).getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Trip' },
    });
    fireEvent.click(
      within(card('Trip')).getByRole('button', { name: 'Publish it' })
    );
    await settle();
    expect(publishes).toHaveLength(1);
  });
});

describe("VideoPublisher, the run's progress", () => {
  it('still counts a video as converted after its upload failed', async () => {
    renderWindow();
    await addVideos(file('First.mp4'), file('Second.mp4'));
    await choose(
      'Category',
      'Education',
      screen.getByRole('group', { name: 'Same for all videos' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (2)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    expect(screen.getByText('Converted: 1 of 2')).toBeInTheDocument();
    // The node can't be reached for the first; the second still converts.
    const network = { code: 'network' } as never;
    const [video, listing] = publishes[0].steps;
    await act(async () =>
      publishes[0].resolve({
        ok: false,
        outcomes: [
          { key: video.key, status: 'failed', error: network },
          { key: listing.key, status: 'skipped', error: network },
        ],
      })
    );
    await settle();
    expect(card('First')).toHaveAttribute('data-phase', 'failed');
    expect(card('Second')).toHaveAttribute('data-phase', 'converting');
    // Its converted file is kept (its card says so, and Retry won't convert).
    expect(
      within(card('First')).getByText(/^MP4 · 120 MB/)
    ).toBeInTheDocument();
    expect(screen.getByText('Converted: 1 of 2')).toBeInTheDocument();
  });

  it('counts a retried video of an earlier run in the run it shows', async () => {
    renderWindow();
    await addVideos(file('Long.mp4'));
    await choose('Category', 'Other');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() => tool.failJob('job-1', 'output-too-big'));
    await settle();
    expect(card('Long')).toHaveAttribute('data-phase', 'failed');

    // Another video goes up whole in a run of its own.
    await addVideos(file('Talk.mp4'));
    act(() =>
      store.set(videoPublisherSettingsAtom, (current) => ({
        ...current,
        shared: { ...current.shared, category: 99 },
      }))
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-2'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    expect(card('Talk')).toHaveAttribute('data-phase', 'done');

    // The first again: it converts, nothing of it is up yet.
    fireEvent.click(
      within(card('Long')).getByRole('button', { name: 'Retry' })
    );
    await settle();
    expect(card('Long')).toHaveAttribute('data-phase', 'converting');
    const progress = screen.getByRole('group', {
      name: 'Progress of this run',
    });
    // Not "everything is up" while it converts.
    expect(within(progress).queryByText('Published: 1 of 1')).toBeNull();
  }, 20_000);
});
