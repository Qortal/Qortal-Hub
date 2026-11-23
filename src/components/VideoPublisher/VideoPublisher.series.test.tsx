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
  videoQueueAtom,
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

const addFolder = async (...files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('video-publisher-folder'), {
      target: { files },
    });
  });
  await waitFor(() =>
    expect(screen.queryByText('Reading the file…')).not.toBeInTheDocument()
  );
};

/** A folder of episodes, until `count` videos are listed. */
const addEpisodes = async (count: number, ...files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('video-publisher-folder'), {
      target: { files },
    });
  });
  await waitFor(() =>
    expect(screen.getAllByRole('listitem')).toHaveLength(count)
  );
};

/** The series form's poster picker, in the settings column. */
const seriesPoster = () =>
  within(
    document.querySelector('[data-column="settings"]') as HTMLElement
  ).getByRole('radiogroup', { name: 'Poster' });

/** Alpha's two episodes, published as a series. */
const publishAlpha = async () => {
  await addEpisodes(
    2,
    file('Alpha.S01E01.mkv', 'Alpha/Alpha.S01E01.mkv'),
    file('Alpha.S01E02.mkv', 'Alpha/Alpha.S01E02.mkv')
  );
  await choose('Genre', 'Dramas');
  fireEvent.click(
    screen.getByRole('button', { name: 'Convert and publish the series (2)' })
  );
  await settle();
  for (const job of ['job-1', 'job-2']) {
    act(() => tool.finishJob(job));
    await settle();
    await act(async () => publishes[publishes.length - 1].resolve());
    await settle();
  }
  await act(async () => publishes[2].resolve());
  await settle();
};

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

describe("VideoPublisher, the series' card", () => {
  it('lets the episodes off the list once their series card is dismissed', async () => {
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
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    );
    await choose('Genre', 'Dramas');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    act(() => tool.finishJob('job-2'));
    await settle();
    // The playlist's approval is declined: the series isn't published.
    approvals.mockResolvedValueOnce(false);
    await act(async () => publishes[1].resolve());
    await settle();
    const series = screen.getByRole('region', { name: /^Series: / });
    expect(
      within(series).getByText(/Not published: the approval was declined/)
    ).toBeInTheDocument();
    // Held until then: the playlist could still take them in.
    expect(
      screen.queryByRole('button', { name: /^Take .* off the list$/ })
    ).not.toBeInTheDocument();

    fireEvent.click(within(series).getByRole('button', { name: 'Close' }));
    await settle();
    expect(
      screen.queryByRole('region', { name: /^Series: / })
    ).not.toBeInTheDocument();
    // Each episode stays published on its own, and can leave the list.
    expect(
      screen.getAllByRole('button', { name: /^Take .* off the list$/ })
    ).toHaveLength(2);
  });

  it('does not offer the series without its episodes when none went up', async () => {
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
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    );
    await choose('Genre', 'Dramas');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    act(() => tool.failJob('job-1', 'ffmpeg-failed'));
    await settle();
    act(() => tool.failJob('job-2', 'ffmpeg-failed'));
    await settle();
    expect(
      screen.getByText("Episodes that didn't go up: 2")
    ).toBeInTheDocument();
    // No episode is up: there's no series to publish without them.
    expect(
      screen.queryByRole('button', { name: 'Publish the series without them' })
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
  });

  it('does not offer the series without its episodes once the one up was removed', async () => {
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
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    );
    await choose('Genre', 'Dramas');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    act(() => tool.failJob('job-2', 'ffmpeg-failed'));
    await settle();
    expect(
      screen.getByRole('button', { name: 'Publish the series without them' })
    ).toBeInTheDocument();

    // What went up is removed from Subscreen: no episode is left for it.
    const up = screen
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('data-phase') === 'done');
    fireEvent.click(
      within(up).getByRole('button', { name: 'Remove from Subscreen' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: /from Subscreen\?$/,
    });
    await within(dialog).findByText(/^Fee: /);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove from Subscreen' })
    );
    await settle();
    await act(async () => publishes[1].resolve());
    await settle();
    expect(
      screen.queryByRole('button', { name: 'Publish the series without them' })
    ).not.toBeInTheDocument();
    expect(publishes).toHaveLength(2);
  });

  it('sends the playlist once the failed episode is taken off the list', async () => {
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
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    );
    await choose('Genre', 'Dramas');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    act(() => tool.failJob('job-2', 'ffmpeg-failed'));
    await settle();
    expect(publishes).toHaveLength(1);

    // Not that episode, then: off the list with its ×.
    const failed = screen
      .getAllByRole('listitem')
      .find((item) => item.getAttribute('data-phase') === 'failed');
    fireEvent.click(
      within(failed).getByRole('button', { name: /^Take .* off the list$/ })
    );
    await settle();
    expect(publishes).toHaveLength(2);
    expect(publishes[1].steps.map((step) => step.kind)).toEqual(['playlist']);
    await act(async () => publishes[1].resolve());
    await settle();
    expect(
      within(screen.getByRole('region', { name: /^Series: / })).getByRole(
        'button',
        { name: 'Open in Subscreen' }
      )
    ).toBeInTheDocument();
  });

  it('holds another Publish while the series still owes its playlist to an episode that went up', async () => {
    renderWindow();
    await addEpisodes(
      2,
      file('Show.S01E01.Pilot.mkv', 'Show/Show.S01E01.Pilot.mkv'),
      file('Show.S01E02.Next.mkv', 'Show/Show.S01E02.Next.mkv')
    );
    await choose('Genre', 'Dramas');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    act(() => tool.failJob('job-2', 'ffmpeg-failed'));
    await settle();

    // Another video, for Q-Tube: a new run would drop the series.
    await addVideos(file('Clip.mp4'));
    fireEvent.click(screen.getByRole('button', { name: 'Q-Tube' }));
    await choose('Category', 'Other');
    expect(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    ).toBeDisabled();
    expect(
      screen.getByLabelText(
        'Finish the series above first: its episodes that went up are waiting for it.'
      )
    ).toBeInTheDocument();
    expect(card('Clip')).toHaveAttribute('data-phase', 'ready');

    fireEvent.click(
      screen.getByRole('button', { name: 'Publish the series without them' })
    );
    await settle();
    expect(publishes[1].steps.map((step) => step.kind)).toEqual(['playlist']);
    await act(async () => publishes[1].resolve());
    await settle();
    expect(screen.getByText('The series is on Subscreen.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    ).toBeEnabled();
  });

  it('does not hold the settings for a series that is done while an older video is retried', async () => {
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

    // A series goes up whole in a run of its own.
    await addFolder(
      file('Show.S01E01.mkv', 'Show/Show.S01E01.mkv'),
      file('Show.S01E02.mkv', 'Show/Show.S01E02.mkv')
    );
    await choose('Genre', 'Dramas');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    for (const job of ['job-2', 'job-3']) {
      act(() => tool.finishJob(job));
      await settle();
      await act(async () => publishes[publishes.length - 1].resolve());
      await settle();
    }
    await waitFor(() => expect(publishes).toHaveLength(3));
    await act(async () => publishes[2].resolve());
    await settle();
    expect(screen.getByText('The series is on Subscreen.')).toBeInTheDocument();

    // The first video again: the finished series doesn't hold the window.
    fireEvent.click(
      within(card('Long')).getByRole('button', { name: 'Retry' })
    );
    await settle();
    expect(card('Long')).toHaveAttribute('data-phase', 'converting');
    expect(screen.getByRole('button', { name: 'Q-Tube' })).not.toHaveClass(
      'Mui-disabled'
    );
    expect(
      screen.getByRole('button', { name: 'Clear finished' })
    ).toBeEnabled();
  }, 20_000);
});

describe("VideoPublisher, the series' poster", () => {
  it('offers the next series’ poster from its own episodes, not an earlier series', async () => {
    renderWindow();
    // A first series goes up whole.
    await addFolder(
      file('Alpha.S01E01.mkv', 'Alpha/Alpha.S01E01.mkv'),
      file('Alpha.S01E02.mkv', 'Alpha/Alpha.S01E02.mkv')
    );
    await choose('Genre', 'Dramas');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    await act(async () => publishes[0].resolve());
    await settle();
    act(() => tool.finishJob('job-2'));
    await settle();
    await act(async () => publishes[1].resolve());
    await settle();
    await waitFor(() => expect(publishes).toHaveLength(3));
    await act(async () => publishes[2].resolve());
    await settle();
    expect(screen.getByText('The series is on Subscreen.')).toBeInTheDocument();

    // Then the next one's episodes.
    await addFolder(
      file('Beta.S01E01.mkv', 'Beta/Beta.S01E01.mkv'),
      file('Beta.S01E02.mkv', 'Beta/Beta.S01E02.mkv')
    );
    const beta = new Set(
      store
        .get(videoQueueAtom)
        .filter((item) => item.source.name.startsWith('Beta'))
        .map((item) => item.source.id)
    );
    expect(beta.size).toBe(2);
    // The series' poster, outside the cards.
    const posters = screen
      .getAllByRole('radiogroup', { name: 'Poster' })
      .filter((group) => !group.closest('li'));
    expect(posters).toHaveLength(1);
    const frame = await within(posters[0]).findAllByRole('radio', {
      name: /^Frame at /,
    });
    fireEvent.click(frame[0]);
    const poster = store.get(videoPublisherSettingsAtom).series.poster;
    expect(poster?.kind).toBe('frame');
    expect([...beta]).toContain((poster as { sourceId: string }).sourceId);
  }, 20_000);

  it('offers the poster from the episodes of the series being published', async () => {
    renderWindow();
    await publishAlpha();
    // The next series, another show; Alpha's episodes are still listed.
    await addEpisodes(
      4,
      file('Beta.S01E01.mkv', 'Beta/Beta.S01E01.mkv'),
      file('Beta.S01E02.mkv', 'Beta/Beta.S01E02.mkv')
    );
    await settle();
    const beta = new Set(
      [...tool.sources.values()]
        .filter((source) => source.name.startsWith('Beta'))
        .map((source) => source.id)
    );
    fireEvent.click(
      await within(seriesPoster()).findByRole('radio', {
        name: 'Frame at 0:20',
      })
    );
    const poster = store.get(videoPublisherSettingsAtom).series.poster;
    expect(poster?.kind).toBe('frame');
    expect(beta.has((poster as { sourceId: string }).sourceId)).toBe(true);
  });

  it('shows the series poster it will publish', async () => {
    renderWindow();
    await addEpisodes(
      2,
      file('Alpha.S01E01.mkv', 'Alpha/Alpha.S01E01.mkv'),
      file('Alpha.S01E02.mkv', 'Alpha/Alpha.S01E02.mkv')
    );
    await choose('Genre', 'Dramas');
    // A frame of the first episode as the series' poster.
    const frame = await within(seriesPoster()).findByRole('radio', {
      name: 'Frame at 0:10',
    });
    fireEvent.click(frame);
    expect(frame).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    );
    await settle();
    for (const job of ['job-1', 'job-2']) {
      act(() => tool.finishJob(job));
      await settle();
      await act(async () => publishes[publishes.length - 1].resolve());
      await settle();
    }
    await act(async () => publishes[2].resolve());
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    await settle();

    // The next series, another show.
    await addEpisodes(
      2,
      file('Beta.S01E01.mkv', 'Beta/Beta.S01E01.mkv'),
      file('Beta.S01E02.mkv', 'Beta/Beta.S01E02.mkv')
    );
    await settle();
    expect(store.get(videoPublisherSettingsAtom).series.poster).not.toBeNull();
    // A poster is set, and goes up with this series: the picker says which.
    const checked = within(seriesPoster())
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
  });
});
