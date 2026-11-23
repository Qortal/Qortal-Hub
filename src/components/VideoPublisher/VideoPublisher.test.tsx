import { ThemeProvider } from '@mui/material/styles';
import {
  act,
  cleanup,
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
import i18n from '../../i18n/i18n';
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
  fakeProbe,
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
  resolve: () => void;
};

let tool: FakeVideoTool;
let store: ReturnType<typeof createStore>;
let publishes: Publish[];
let publicNode = false;
let feeFails = false;
/** Hub's approval right before a video goes up: accepted unless said. */
let approvals: Mock<(request: PublishApprovalRequest) => Promise<boolean>>;

const file = (name: string, relativePath?: string) => {
  const value = new File(['x'], name);
  if (relativePath) {
    Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  }
  return value;
};

const renderWindow = (
  user: object | null = {
    address: 'Qaddress',
    name: 'Tester',
    publicKey: 'pubkey',
  },
  // Most tests follow a run straight through; the window's own default
  // (preview first) has a test of its own.
  { previewFirst = false }: { previewFirst?: boolean } = {}
) => {
  store.set(userInfoAtom, user);
  // Through the defaults: a sign-in resets the settings to them.
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = previewFirst;
  store.set(videoPublisherSettingsAtom, {
    ...VIDEO_PUBLISHER_DEFAULT_SETTINGS,
  });
  setVideoPublisherControllerForTests(
    new VideoPublisherController({
      store,
      bridge: () => tool,
      isPublicNode: async () => publicNode,
      makeCover: vi.fn(async () => WEBP),
      makeExtracts: vi.fn(async (frames) => frames.map(() => WEBP)),
      makeQshareThumbnail: vi.fn(async () => WEBP),
      waitForPublishSlot: vi.fn(async () => true),
      requestApproval: approvals,
      estimatePublishFee: vi.fn(async (count) => {
        if (feeFails) throw new Error('node down');
        return {
          unitFee: 0.01,
          count: Number(count),
          total: Math.round(Number(count) * 1e6) / 1e8,
        };
      }),
      checkPublishBalance: vi.fn(async () => ({ balance: 12.5, enough: true })),
      runPublishSteps: vi.fn(
        (steps, options) =>
          new Promise<RunPublishResult>((resolve) => {
            publishes.push({
              steps,
              options,
              resolve: () => {
                const outcomes = steps.map((step) => ({
                  key: step.key,
                  status: 'published' as const,
                }));
                outcomes.forEach((outcome) => options.onStepDone?.(outcome));
                resolve({ ok: true, outcomes });
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
  publicNode = false;
  feeFails = false;
  approvals = vi.fn(async () => true);
  window.localStorage.clear();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS.reviewFirst = PREVIEW_FIRST_DEFAULT;
  setVideoPublisherControllerForTests(null);
  delete window.videoTool;
});

describe('VideoPublisher', () => {
  it('starts with a drop zone, the pickers and the node limit', async () => {
    renderWindow();
    expect(
      screen.getByText('Drop videos or a folder here')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose videos' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Choose a folder' })
    ).toBeEnabled();
    expect(
      await screen.findByText(/Up to 2(\.0)? GB per video on your node/)
    ).toBeInTheDocument();
    expect(screen.getByTestId('video-publisher-folder')).toHaveAttribute(
      'webkitdirectory'
    );
  });

  it('says the smaller limit on a public node', async () => {
    publicNode = true;
    renderWindow();
    expect(
      await screen.findByText(/Up to 500 MB per video on a public node/)
    ).toBeInTheDocument();
  });

  it('says when Hub has no converter', async () => {
    vi.mocked(tool.status).mockResolvedValueOnce({
      available: false,
      reason: 'missing-binary',
    });
    renderWindow();
    expect(
      await screen.findByText(/came without its video converter/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose videos' })
    ).toBeDisabled();
  });

  it('lists added videos with what the probe found', async () => {
    tool.probes.set(
      'Big.Movie.2019.1080p.mkv',
      fakeProbe({
        durationSec: 5400,
        video: { ...fakeProbe().video, codec: 'hevc', bitDepth: 10 },
        audio: [{ index: 1, codec: 'ac3', channels: 6, isDefault: true }],
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'eng',
            isDefault: false,
            kind: 'text',
            isForced: false,
          },
        ],
        playableAsIs: false,
        container: 'matroska,webm',
      })
    );
    renderWindow();
    await addVideos(
      file('Big.Movie.2019.1080p.mkv'),
      file('notes.txt'),
      file('song.mp3')
    );
    const movie = card('Big Movie');
    // The original: its file type and size first.
    const original = within(movie).getByText(
      /MKV · 0 kB · 1080p · 1920×1080 · 1:30:00 · HEVC 10-bit · AC-3 5\.1 · subtitles: 1/
    );
    expect(original).toHaveTextContent(/^Original MKV/);
    // A bigger thumbnail than an icon's.
    expect(within(movie).getByTestId('video-publisher-thumb')).toHaveStyle({
      width: '112px',
      height: '63px',
    });
    expect(within(movie).getByText(/^Ready/)).toBeInTheDocument();
    // What was left out, and why, at the window's own text size.
    const note = screen.getByText(
      'Left out: notes.txt (not a video), song.mp3 (audio only).'
    );
    expect(note.closest('.MuiAlert-root')).toHaveStyle({ fontSize: '0.8rem' });
  });

  it("shows each app's own picture on its button", async () => {
    renderWindow();
    await addVideos(file('Clip.mp4'));
    for (const name of ['Q-Tube', 'Subscreen', 'Torq', 'Q-Share']) {
      const button = screen.getByRole('button', { name });
      const picture = within(button)
        .getByTestId('video-publisher-app-avatar')
        .querySelector('img');
      expect(picture?.getAttribute('src')).toContain(
        `/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/qortal_avatar`
      );
    }
    expect(
      within(
        screen.getByRole('button', { name: 'Save to this PC' })
      ).queryByTestId('video-publisher-app-avatar')
    ).not.toBeInTheDocument();
  });

  it("adds through Hub's own picker, worded for publishing, not uploading", async () => {
    renderWindow();
    tool.nextPick = [file('Picked.mp4')];
    fireEvent.click(screen.getByRole('button', { name: 'Choose videos' }));
    await settle();
    expect(tool.pickFiles).toHaveBeenLastCalledWith({
      folder: false,
      title: 'Choose videos',
      buttonLabel: 'Add for publishing',
      filterName: 'Videos and subtitles',
    });
    expect(card('Picked')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save to this PC' }));
    tool.nextPick = [file('Ep.mkv', 'Show/Season 1/Ep.mkv')];
    fireEvent.click(screen.getByRole('button', { name: 'Add a folder' }));
    await settle();
    expect(tool.pickFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({
        folder: true,
        title: 'Choose a folder',
        buttonLabel: 'Add for converting',
      })
    );
    expect(card('Ep')).toBeInTheDocument();
    // Cancelled: nothing added, nothing said.
    fireEvent.click(screen.getByRole('button', { name: 'Add videos' }));
    await settle();
    expect(tool.pickFiles).toHaveBeenCalledTimes(3);
    expect(document.querySelectorAll('li[data-phase]')).toHaveLength(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('publishes the ticked videos, then the rest to another app while the run goes', async () => {
    renderWindow();
    await addVideos(file('First.mp4'), file('Second.mp4'));
    await choose('Category', 'Education');
    // Second waits for later: unticked, it's out of this Publish.
    fireEvent.click(
      within(card('Second')).getByRole('checkbox', {
        name: 'Include Second in the next publish',
      })
    );
    expect(
      within(card('Second')).getByText('Not ticked: waits for a later publish')
    ).toBeInTheDocument();
    expect(screen.getByText('Ticked: 1 of 2')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(1);
    expect(card('Second')).toHaveAttribute('data-phase', 'ready');
    // Each card in the run says where it goes.
    expect(
      within(card('First')).getByTestId('video-publisher-destination-tag')
    ).toHaveTextContent('Q-Tube');

    // While it goes: Second, the only one ready now (no tick then), to
    // Torq.
    expect(
      within(card('Second')).queryByRole('checkbox')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Torq' }));
    const join = screen.getByRole('button', {
      name: 'Convert and publish to Torq (1)',
    });
    expect(join).toBeEnabled();
    expect(
      screen.getByText(
        'Published now, they go after the videos in progress, each to its own app.'
      )
    ).toBeInTheDocument();
    // No question before converting: it joins the run at once.
    fireEvent.click(join);
    await settle();
    expect(card('Second')).toHaveAttribute('data-phase', 'waiting');
    expect(
      within(card('Second')).getByTestId('video-publisher-destination-tag')
    ).toHaveTextContent('Torq');
    expect(
      within(card('First')).getByTestId('video-publisher-destination-tag')
    ).toHaveTextContent('Q-Tube');
    expect(screen.getByText('Converted: 0 of 2')).toBeInTheDocument();
    act(() => tool.finishJob('job-1'));
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(2);
    act(() => tool.finishJob('job-2'));
    await settle();
    // The first goes up to Q-Tube, then the second to Torq.
    await waitFor(() => expect(publishes).toHaveLength(1));
    expect(publishes[0].steps.map((step) => step.kind)).toEqual([
      'video',
      'metadata',
    ]);
    await act(async () => publishes[0].resolve());
    await waitFor(() => expect(publishes).toHaveLength(2));
    expect(publishes[1].steps.map((step) => step.kind)).toContain('post');
    await act(async () => publishes[1].resolve());
    await waitFor(() =>
      expect(card('Second')).toHaveAttribute('data-phase', 'done')
    );
  }, 20_000);

  it("previews each converted video by default, then publishes it on the user's word", async () => {
    expect(PREVIEW_FIRST_DEFAULT).toBe(true);
    renderWindow(undefined, { previewFirst: true });
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    expect(
      screen.getByRole('checkbox', {
        name: /Preview each converted video first/,
      })
    ).toBeChecked();
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert for Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    // Converted: it waits, with the video to watch, until Publish it.
    expect(
      within(card('Trip')).getByLabelText('Converted video')
    ).toBeInTheDocument();
    expect(publishes).toHaveLength(0);
    fireEvent.click(
      within(card('Trip')).getByRole('button', { name: 'Publish it' })
    );
    await settle();
    expect(publishes).toHaveLength(1);
  });

  it('minimizes a converted video waiting to be checked', async () => {
    renderWindow();
    await addVideos(file('Clip.mp4'));
    fireEvent.click(screen.getByRole('button', { name: 'Save to this PC' }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Preview each converted video first/,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Convert (1)' }));
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    const clip = card('Clip');
    expect(within(clip).getByLabelText('Converted video')).toBeInTheDocument();
    fireEvent.click(within(clip).getByRole('button', { name: 'Minimize' }));
    expect(
      within(clip).queryByLabelText('Converted video')
    ).not.toBeInTheDocument();
    // Save it stays.
    expect(
      within(clip).getByRole('button', { name: 'Save it' })
    ).toBeInTheDocument();
    fireEvent.click(
      within(clip).getByRole('button', { name: 'Show the preview' })
    );
    expect(within(clip).getByLabelText('Converted video')).toBeInTheDocument();
  });

  it('names three left-out files at most, then how many more', async () => {
    renderWindow();
    await addVideos(
      file('Clip.mp4'),
      file('a.txt'),
      file('b.mp3'),
      file('e.zip'),
      file('c.pdf'),
      file('d.pdf')
    );
    expect(
      screen.getByText(
        'Left out: a.txt (not a video), b.mp3 (audio only), e.zip (not a video) and 2 more.'
      )
    ).toBeInTheDocument();
  });

  it('says mono and stereo for the sound', async () => {
    tool.probes.set(
      'Mono.mp4',
      fakeProbe({
        audio: [{ index: 1, codec: 'aac', channels: 1, isDefault: true }],
      })
    );
    renderWindow();
    await addVideos(file('Mono.mp4'), file('Stereo.mp4'));
    expect(within(card('Mono')).getByText(/· AAC mono$/)).toBeInTheDocument();
    expect(
      within(card('Stereo')).getByText(/· AAC stereo$/)
    ).toBeInTheDocument();
  });

  it('shows the chosen app’s own fields, prefilled from the file name', async () => {
    renderWindow();
    await addVideos(file('The.Film.2001.720p.mp4'));
    const film = card('The Film');
    // One video: its details are open.
    expect(within(film).getByRole('textbox', { name: 'Title' })).toHaveValue(
      'The Film'
    );
    expect(
      within(film).getByRole('combobox', { name: 'Category' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Subscreen' }));
    expect(
      within(card('The Film')).getByRole('spinbutton', { name: 'Year' })
    ).toHaveValue(2001);
    expect(
      within(card('The Film')).getByRole('combobox', { name: 'Genre' })
    ).toBeInTheDocument();
    expect(within(card('The Film')).getByText('Poster')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Torq' }));
    expect(
      within(card('The Film')).getByRole('textbox', { name: 'Post text' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Q-Share' }));
    fireEvent.change(
      within(card(/The Film|Café/)).getByRole('textbox', { name: 'Title' }),
      {
        target: { value: 'Café ünïcode' },
      }
    );
    expect(screen.getByText('Q-Share keeps: Cafe unicode')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save to this PC' }));
    expect(
      screen.queryByRole('textbox', { name: 'Title' })
    ).not.toBeInTheDocument();
  });

  it('asks for the real poster where a film or series shows one upright', async () => {
    renderWindow();
    await addVideos(file('The.Film.2001.720p.mp4'));
    const prompt = () =>
      within(card('The Film')).queryByTestId('video-publisher-poster-prompt');
    const note = () =>
      within(card('The Film')).queryByTestId('video-publisher-note-poster');
    // Q-Tube, and not a film or a series: a cover, not a poster.
    expect(prompt()).not.toBeInTheDocument();
    await choose('Category', 'Music', card('The Film'));
    expect(prompt()).not.toBeInTheDocument();
    expect(note()).not.toBeInTheDocument();
    // Q-Tube's Movies (and Series) show on Subscreen too, upright.
    await choose('Category', 'Movies', card('The Film'));
    expect(prompt()).toHaveTextContent(
      /Films and series show on Subscreen too/
    );
    expect(note()).toHaveTextContent(/No poster chosen yet/);
    // Subscreen's own film.
    fireEvent.click(screen.getByRole('button', { name: 'Subscreen' }));
    expect(prompt()).toHaveTextContent(
      /Subscreen shows films and series with an upright poster/
    );
    expect(
      within(card('The Film')).getByRole('radio', { name: 'Automatic' })
    ).toHaveTextContent('A frame, cut upright');
    // Its own picture chosen: no more asking.
    const input = card('The Film').querySelector(
      'input[accept="image/*"]'
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [new File(['p'], 'poster.png', { type: 'image/png' })],
        },
      });
    });
    await waitFor(() => expect(prompt()).not.toBeInTheDocument());
    expect(note()).not.toBeInTheDocument();
  });

  it('keeps the picked app’s picture on a backdrop of its own, five in a row', async () => {
    renderWindow();
    await addVideos(file('Clip.mp4'));
    fireEvent.click(screen.getByRole('button', { name: 'Q-Share' }));
    const picked = screen.getByRole('button', { name: 'Q-Share' });
    expect(picked).toHaveAttribute('aria-pressed', 'true');
    // Q-Share's light blue picture would vanish on the blue picked tile.
    expect(
      within(picked).getByTestId('video-publisher-app-avatar')
    ).toHaveStyle({
      backgroundColor: 'rgb(255, 255, 255)',
      borderRadius: '50%',
    });
    // One row of five, however narrow the column.
    expect(picked.parentElement).toHaveStyle({
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    });
    expect(
      within(picked.parentElement as HTMLElement).getAllByRole('button')
    ).toHaveLength(5);
  });

  it('keeps the main button in a bar of its own, beside the two panes', async () => {
    renderWindow();
    await addVideos(file('Clip.mp4'));
    const start = screen.getByRole('button', {
      name: 'Convert and publish to Q-Tube (1)',
    });
    const bar = start.closest('[data-column="actions"]');
    const queue = screen
      .getByRole('list', { name: 'Videos to publish' })
      .closest('[data-column="queue"]');
    const settings = screen
      .getByRole('group', { name: 'Where to' })
      .closest('[data-column="settings"]');
    // One grid holds all three, so the bar can stay in view under a single
    // column (a tall, narrow window) and sit under the settings when wide.
    expect(bar).not.toBeNull();
    expect(bar?.parentElement).toBe(queue?.parentElement);
    expect(bar?.parentElement).toBe(settings?.parentElement);
    expect(settings?.contains(start)).toBe(false);
  });

  it('warns when a film is too short for Subscreen’s lists', async () => {
    tool.probes.set('Short.mp4', fakeProbe({ durationSec: 300 }));
    renderWindow();
    await addVideos(file('Short.mp4'));
    fireEvent.click(screen.getByRole('button', { name: 'Subscreen' }));
    expect(screen.getByText(/Shorter than 10 minutes/)).toBeInTheDocument();
  });

  it('takes a folder of episodes as a Subscreen series, with editable episodes', async () => {
    renderWindow();
    await act(async () => {
      fireEvent.change(screen.getByTestId('video-publisher-folder'), {
        target: {
          files: [
            file(
              'Show.S01E02.The.Second.mkv',
              'Show/Show.S01E02.The.Second.mkv'
            ),
            file('Show.S01E01.Pilot.mkv', 'Show/Show.S01E01.Pilot.mkv'),
            file('cover.jpg', 'Show/cover.jpg'),
          ],
        },
      });
    });
    await waitFor(() =>
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
    );
    expect(screen.getByRole('button', { name: 'TV series' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Series title' })).toHaveValue(
      'Show'
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAccessibleName('S01E01 · Pilot');
    expect(items[1]).toHaveAccessibleName('S01E02 · The Second');

    fireEvent.click(
      within(items[1]).getByRole('button', { name: /Details of/ })
    );
    fireEvent.change(
      within(items[1]).getByRole('spinbutton', { name: 'Episode' }),
      {
        target: { value: '7' },
      }
    );
    expect(screen.getAllByRole('listitem')[1]).toHaveAccessibleName(
      'S01E07 · The Second'
    );
    // The series still needs its genre.
    expect(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    ).toBeDisabled();
    await choose('Genre', 'Dramas');
    expect(
      screen.getByRole('button', { name: 'Convert and publish the series (2)' })
    ).toBeEnabled();
    // Previewed first, it only converts: each episode goes up from its card.
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Preview each converted video first/,
      })
    );
    expect(
      screen.getByRole('button', { name: 'Convert the series (2)' })
    ).toBeEnabled();
    // Many fields and two cards: slow on a busy PC.
  }, 20_000);

  it('greys qualities above the video’s size and too long for the limit', async () => {
    publicNode = true;
    tool.probes.set(
      'Clip.mp4',
      fakeProbe({
        durationSec: 3600,
        video: {
          ...fakeProbe().video,
          width: 1280,
          height: 720,
          displayWidth: 1280,
          displayHeight: 720,
        },
      })
    );
    renderWindow();
    await addVideos(file('Clip.mp4'));
    // H.264: AV1 fits this hour in 500 MB even at 720p.
    fireEvent.click(screen.getByRole('button', { name: /^H\.264/ }));
    // The one place quality is chosen: the window's, greyed above the
    // video's own size. The card has no list of its own.
    expect(
      within(card('Clip')).queryByRole('radiogroup', { name: 'Quality' })
    ).not.toBeInTheDocument();
    const step = (name: string) => screen.getByRole('button', { name });
    expect(step('1080p')).toBeDisabled();
    expect(step('720p')).toBeEnabled();
    expect(
      screen.getByText(
        /Your videos go up to 720p, so bigger sizes are greyed out/
      )
    ).toBeInTheDocument();
    // An hour at 720p doesn't fit 500 MB: the window's 720p steps down.
    expect(
      screen.getByText(/Too long for 720p within the limit: converts at 540p/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Keep as is/ })).toBeDisabled();
    fireEvent.click(step('360p'));
    expect(step('360p')).toHaveAttribute('aria-pressed', 'true');
    expect(within(card('Clip')).getByText(/360p, at most/)).toBeInTheDocument();
    // Original quality: its own size, as close to the original as fits.
    fireEvent.click(screen.getByRole('button', { name: /^Original quality/ }));
    expect(
      screen.getByRole('button', { name: /^Original quality/ })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(/No video comes out bigger than its original\./)
    ).toBeInTheDocument();
  });

  it('promises no size for a video whose length is not known', async () => {
    // Main couldn't measure it either (a damaged browser recording).
    tool.probes.set('Recording.webm', fakeProbe({ durationSec: 0 }));
    tool.probes.set('Clip.mp4', fakeProbe());
    renderWindow();
    await addVideos(file('Recording.webm'), file('Clip.mp4'));
    fireEvent.click(screen.getByRole('button', { name: '720p' }));
    expect(
      within(card('Recording')).queryByText(/at most/)
    ).not.toBeInTheDocument();
    expect(within(card('Recording')).getByText(/· 720p$/)).toBeInTheDocument();
    expect(within(card('Clip')).getByText(/720p, at most/)).toBeInTheDocument();
  });

  const format = (name: RegExp) => screen.getByRole('button', { name });
  const toolStatus = (av1: boolean, cpuThreads: number) =>
    vi.mocked(tool.status).mockResolvedValue({
      available: true,
      ffmpegVersion: 'test',
      freeBytes: 100 * 1024 ** 3,
      av1,
      cpuThreads,
      canPause: true,
    });

  it('converts to AV1 by default, or to H.264 when chosen', async () => {
    renderWindow();
    await addVideos(file('Clip.mp4'));
    await waitFor(() =>
      expect(format(/^AV1/)).toHaveAttribute('aria-pressed', 'true')
    );
    expect(
      screen.getByText(/Often 40 % smaller than H\.264/)
    ).toBeInTheDocument();
    fireEvent.click(format(/^H\.264/));
    expect(format(/^H\.264/)).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(/Converts faster and plays everywhere/)
    ).toBeInTheDocument();
  });

  it('picks H.264 on a PC with few threads, and says why', async () => {
    toolStatus(true, 4);
    renderWindow();
    await addVideos(file('Clip.mp4'));
    await waitFor(() =>
      expect(
        screen.getByText(/This PC has few processor threads \(4\)/)
      ).toBeInTheDocument()
    );
    expect(format(/^H\.264/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers H.264 only when the converter has no AV1', async () => {
    toolStatus(false, 16);
    renderWindow();
    await addVideos(file('Clip.mp4'));
    await waitFor(() => expect(format(/^AV1/)).toBeDisabled());
    expect(screen.getByText(/This Hub can't write AV1/)).toBeInTheDocument();
  });

  it('asks for approval with the resources and fee right before publishing', async () => {
    tool.probes.set(
      'Second.mp4',
      fakeProbe({
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'eng',
            isDefault: false,
            kind: 'text',
            isForced: false,
          },
        ],
      })
    );
    renderWindow();
    await addVideos(file('First.mp4'), file('Second.mp4'));
    const publish = screen.getByRole('button', {
      name: 'Convert and publish to Q-Tube (2)',
    });
    expect(publish).toBeDisabled();
    expect(screen.getAllByText(/Still needs a category/)).toHaveLength(2);

    await choose(
      'Category',
      'Other',
      screen.getByRole('group', { name: 'Same for all videos' })
    );
    expect(publish).toBeEnabled();
    expect(
      screen.getByText(
        /Hub asks for your approval, with the fee, right before each video goes up\./
      )
    ).toBeInTheDocument();
    // Converting starts at once: nothing is asked before.
    fireEvent.click(publish);
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(1);
    expect(approvals).not.toHaveBeenCalled();
    // Right before the first goes up: its resources and their fee. Video
    // and listing: 2 × 0.01 QORT.
    act(() => tool.finishJob('job-1'));
    await settle();
    await waitFor(() => expect(approvals).toHaveBeenCalledTimes(1));
    const { resources, fee } = approvals.mock.calls[0][0];
    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({ service: 'VIDEO', name: 'Tester' });
    expect(fee).toBeCloseTo(0.02, 8);
    await waitFor(() => expect(publishes).toHaveLength(1));
  });

  it('holds a video that came out shorter than its original, and says why', async () => {
    renderWindow();
    // A 20-minute file that stops being readable after 15 (a download not
    // finished): ffmpeg ends normally with what it could read.
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1', { durationSec: 900 }));
    await settle();
    // Waits to be checked, though the run didn't ask for that.
    expect(
      within(card('Trip')).getByText(
        'The converted video is shorter than the original (15:00 of 20:00). The original file may be damaged or not fully downloaded.'
      )
    ).toBeInTheDocument();
    expect(
      within(card('Trip')).getByRole('button', { name: 'Publish it' })
    ).toBeInTheDocument();
    expect(approvals).not.toHaveBeenCalled();
    expect(publishes).toHaveLength(0);
  });

  it('converts and publishes in one go, then offers Open, Copy link and Remove', async () => {
    renderWindow();
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(1);
    act(() =>
      tool.emit({
        ...tool.jobs.get('job-1'),
        phase: 'encoding',
        percent: 42,
        etaSec: 170,
      })
    );
    // Its % and time left beside its bar: the one place they show.
    expect(within(card('Trip')).getByText(/^Converting$/)).toBeInTheDocument();
    expect(
      within(card('Trip')).getByTestId('video-publisher-progress-text')
    ).toHaveTextContent('42 % · 3 min left');
    expect(within(card('Trip')).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '42'
    );
    expect(screen.getAllByText(/42 %/)).toHaveLength(1);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    act(() =>
      tool.emit({
        ...tool.jobs.get('job-1'),
        phase: 'encoding',
        percent: 97.6,
        etaSec: 4.2,
      })
    );
    expect(
      within(card('Trip')).getByTestId('video-publisher-progress-text')
    ).toHaveTextContent('97 % · 5 s left');
    expect(
      screen.getByRole('button', { name: 'Cancel all' })
    ).toBeInTheDocument();

    act(() => tool.finishJob('job-1'));
    await settle();
    expect(publishes).toHaveLength(1);
    expect(publishes[0].steps.map((step) => step.kind)).toEqual([
      'video',
      'metadata',
    ]);
    expect(publishes[0].steps[1].dependsOn).toEqual([
      publishes[0].steps[0].key,
    ]);

    await act(async () => publishes[0].resolve());
    await settle();
    const done = card('Trip');
    expect(within(done).getByText(/^Published/)).toBeInTheDocument();
    fireEvent.click(within(done).getByRole('button', { name: 'Copy link' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringMatching(
          /^qortal:\/\/APP\/Q-Tube\/video\/Tester\/qtube_vid_trip_\w{6}_metadata$/
        )
      )
    );
    expect(
      within(done).getByRole('button', { name: 'Open in Q-Tube' })
    ).toBeInTheDocument();

    fireEvent.click(
      within(done).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    const remove = await screen.findByRole('dialog', {
      name: 'Remove “Trip” from Q-Tube?',
    });
    expect(
      await within(remove).findByText('Fee: 0.02 QORT')
    ).toBeInTheDocument();
    fireEvent.click(
      within(remove).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    await settle();
    expect(publishes[1].steps.map((step) => step.data)).toEqual([
      { base64: 'RA==' },
      { base64: 'RA==' },
    ]);
    await act(async () => publishes[1].resolve());
    await settle();
    expect(
      within(card('Trip')).getByText('Removed from Q-Tube')
    ).toBeInTheDocument();
  });

  it('shows the fields as fixed once publishing starts, and announces only what happened', async () => {
    renderWindow();
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    expect(
      within(card('Trip')).getByRole('textbox', { name: 'Title' })
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    const publishing = card('Trip');
    expect(
      within(publishing).getByRole('textbox', { name: 'Title' })
    ).toBeDisabled();
    // The card's status changes with each percent: it isn't a live region.
    expect(publishing.querySelector('[aria-live]')).toBeNull();
    await act(async () => publishes[0].resolve());
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent(/^Trip: Published/);
  });

  it('holds Publish while a title is longer than the app takes', async () => {
    renderWindow();
    await addVideos(file('Trip.mp4'));
    await choose('Category', 'Travel & Adventure');
    fireEvent.change(
      within(card('Trip')).getByRole('textbox', { name: 'Title' }),
      { target: { value: 'x'.repeat(200) } }
    );
    expect(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    ).toBeDisabled();
    expect(
      within(card(/^x+$/)).getByText('Still needs a shorter title.')
    ).toBeInTheDocument();
  });

  it('does not remove while the fee is unknown, and counts one resource right', async () => {
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
    feeFails = true;
    fireEvent.click(
      within(card('Trip')).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    const remove = await screen.findByRole('dialog', {
      name: 'Remove “Trip” from Q-Tube?',
    });
    expect(
      await within(remove).findByText(
        "Couldn't get the fee or check the balance with the node."
      )
    ).toBeInTheDocument();
    expect(
      within(remove).getByRole('button', { name: 'Remove from Q-Tube' })
    ).toBeDisabled();
    // What went up of a cancelled upload can be one resource.
    expect(
      i18n.t('core:video_publisher.remove_confirm.body', {
        app: 'Q-Tube',
        count: 1,
      })
    ).toBe(
      "QDN can't erase a publish: Hub replaces 1 resource with an empty one, and Q-Tube then treats it as deleted."
    );
  });

  it("counts the account's unconfirmed fees in the card's Remove", async () => {
    const quote = vi.spyOn(VideoPublisherController.prototype, 'quote');
    try {
      renderWindow();
      await addVideos(file('Trip.mp4'));
      await choose('Category', 'Travel & Adventure');
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Convert and publish to Q-Tube (1)',
        })
      );
      await settle();
      act(() => tool.finishJob('job-1'));
      await settle();
      await act(async () => publishes[0].resolve());
      await settle();
      fireEvent.click(
        within(card('Trip')).getByRole('button', { name: 'Remove from Q-Tube' })
      );
      const remove = await screen.findByRole('dialog', {
        name: 'Remove “Trip” from Q-Tube?',
      });
      await within(remove).findByText(/^Fee: /);
      // With the account's key: the publish's own fees are still unconfirmed.
      expect(quote).toHaveBeenCalledWith(2, 'Qaddress', 'pubkey');
    } finally {
      quote.mockRestore();
    }
  });

  it('lets each converted video be watched first, with its subtitles', async () => {
    renderWindow();
    await addVideos(file('Talk.mp4'));
    await choose('Category', 'Education');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Preview each converted video first/,
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert for Q-Tube (1)' })
    );
    await settle();
    act(() =>
      tool.finishJob('job-1', {
        subtitles: [{ id: 's0', language: 'en', bytes: 30 }],
      })
    );
    await settle();
    const talk = card('Talk');
    const preview = within(talk).getByLabelText('Converted video');
    expect(preview).toHaveAttribute('src', 'hub-video://job/job-1/video.mp4');
    // Without CORS mode Chromium refuses the hub-video:// subtitle tracks.
    expect(preview).toHaveAttribute('crossorigin', 'anonymous');
    expect(preview.querySelector('track')).toHaveAttribute(
      'src',
      'hub-video://job/job-1/subtitles/s0.vtt'
    );
    expect(publishes).toHaveLength(0);
    // The run says what the card says: converted, waiting to be checked.
    expect(screen.getByText('Converted: 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('Published: 0 of 1')).toBeInTheDocument();
    expect(screen.getByText('Waiting for you to check: 1')).toBeInTheDocument();
    // And what it became, beside the original.
    expect(
      within(talk).getByText(/^MP4 · 120 MB · 720p · 1280×720$/)
    ).toHaveTextContent(/^Converted MP4/);
    fireEvent.click(within(talk).getByRole('button', { name: 'Publish it' }));
    await settle();
    expect(publishes).toHaveLength(1);
  });

  it('says when a video can go up as it is, and its button follows Keep as is', async () => {
    tool.probes.set(
      'Film.mkv',
      fakeProbe({
        video: { ...fakeProbe().video, codec: 'hevc' },
        playableAsIs: false,
      })
    );
    renderWindow();
    await addVideos(file('Clip.mp4'));
    const ready = within(card('Clip')).getByTestId(
      'video-publisher-note-as_is'
    );
    expect(ready).toHaveTextContent(
      /^Ready to publish as it is: H\.264 and AAC, under the .+ limit\. Choose “Keep as is” under Quality to skip converting\.$/
    );
    expect(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    ).toBeInTheDocument();

    // Kept as it is: nothing to convert, so the button doesn't say so.
    fireEvent.click(screen.getByRole('button', { name: /^Keep as is/ }));
    expect(
      within(card('Clip')).getByTestId('video-publisher-note-as_is')
    ).toHaveTextContent(/It goes up without converting\.$/);
    expect(
      screen.getByRole('button', { name: 'Publish to Q-Tube (1)' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Preview each/ }));
    expect(
      screen.getByRole('button', { name: 'Prepare for Q-Tube (1)' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Preview each/ }));

    // An HEVC film needs converting: no note, and the button says Convert.
    await addVideos(file('Film.mkv'));
    expect(
      within(card('Film')).queryByTestId('video-publisher-note-as_is')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (2)' })
    ).toBeInTheDocument();

    // Saved to this PC, "ready to publish" means nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Save to this PC' }));
    expect(
      screen.queryByTestId('video-publisher-note-as_is')
    ).not.toBeInTheDocument();
  });

  it('pauses a conversion and goes on from there', async () => {
    renderWindow();
    await addVideos(file('Long.mp4'));
    await choose('Category', 'Other');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() =>
      tool.emit({
        ...tool.jobs.get('job-1'),
        phase: 'encoding',
        percent: 42,
        etaSec: 180,
      })
    );
    const long = card('Long');
    expect(
      within(long).getByTestId('video-publisher-progress-text')
    ).toHaveTextContent('42 % · 3 min left');

    fireEvent.click(
      within(long).getByRole('button', { name: 'Pause converting Long' })
    );
    await settle();
    expect(tool.pauseJob).toHaveBeenCalledWith('job-1');
    expect(within(long).getByText('Paused')).toBeInTheDocument();
    expect(
      within(long).getByTestId('video-publisher-progress-text')
    ).toHaveTextContent(/^42 %$/);
    const resume = within(long).getByRole('button', {
      name: 'Resume converting Long',
    });
    expect(resume).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(resume);
    await settle();
    expect(tool.resumeJob).toHaveBeenCalledWith('job-1');
    expect(within(long).getByText('Converting')).toBeInTheDocument();
    expect(
      within(long).getByRole('button', { name: 'Pause converting Long' })
    ).toBeInTheDocument();
  });

  it('has no Pause where the converter can’t pause', async () => {
    vi.mocked(tool.status).mockResolvedValue({
      available: true,
      ffmpegVersion: 'test',
      freeBytes: 100 * 1024 ** 3,
      av1: true,
      cpuThreads: 16,
      canPause: false,
    });
    renderWindow();
    await addVideos(file('Long.mp4'));
    await choose('Category', 'Other');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    expect(
      within(card('Long')).queryByRole('button', { name: /Pause converting/ })
    ).not.toBeInTheDocument();
  });

  it('keeps subtitles and the description open while it converts, and everything after a Cancel', async () => {
    tool.probes.set(
      'Film.mkv',
      fakeProbe({
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'eng',
            isDefault: true,
            kind: 'text',
            isForced: false,
          },
          {
            index: 3,
            codec: 'hdmv_pgs_subtitle',
            language: 'eng',
            isDefault: false,
            kind: 'picture',
            isForced: false,
          },
        ],
      })
    );
    renderWindow();
    await addVideos(file('Film.mkv'));
    await choose('Category', 'Other');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    const film = card('Film');
    // A single video's details open by themselves.
    expect(
      within(film).getByRole('button', { name: 'Details of Film' })
    ).toHaveAttribute('aria-expanded', 'true');
    // Converting: text subtitles and the description can change; burning
    // in is part of the picture being made.
    expect(
      within(film).getByRole('button', { name: 'Add a subtitle file' })
    ).toBeEnabled();
    expect(
      within(film).getByRole('checkbox', { name: /^Track 1/ })
    ).toBeEnabled();
    expect(
      within(film).getByRole('combobox', { name: 'Language of Track 1' })
    ).not.toHaveAttribute('aria-disabled', 'true');
    // One "Language" over the column, not one on every field.
    expect(within(film).getAllByText('Language')).toHaveLength(1);
    expect(within(film).getByRole('checkbox', { name: /Burn/ })).toBeDisabled();
    expect(
      within(film).getByRole('textbox', { name: 'Description' })
    ).toBeEnabled();

    // Cancelled before it was done: everything can change for Retry.
    fireEvent.click(within(film).getByRole('button', { name: 'Cancel Film' }));
    await settle();
    expect(within(film).getByRole('checkbox', { name: /Burn/ })).toBeEnabled();
    expect(
      within(film).getByRole('button', { name: 'Add a subtitle file' })
    ).toBeEnabled();
  });

  it('explains a failure and retries it', async () => {
    renderWindow();
    await addVideos(file('Long.mp4'));
    await choose('Category', 'Other');
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    );
    await settle();
    act(() => tool.failJob('job-1', 'output-too-big'));
    await settle();
    const long = card('Long');
    expect(within(long).getByRole('alert')).toHaveTextContent(
      'It came out bigger than the size limit. Pick a lower quality.'
    );
    // Retry converts again at once; the upload asks when it goes.
    fireEvent.click(within(long).getByRole('button', { name: 'Retry' }));
    await settle();
    expect(tool.startJob).toHaveBeenCalledTimes(2);
    expect(approvals).not.toHaveBeenCalled();
  });

  it('asks before a retried video goes up, and keeps it to be checked', async () => {
    renderWindow();
    await addVideos(file('Talk.mp4'));
    await choose('Category', 'Education');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Preview each converted video first/,
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert for Q-Tube (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all' }));
    await settle();
    expect(within(card('Talk')).getByText(/^Cancelled/)).toBeInTheDocument();

    fireEvent.click(
      within(card('Talk')).getByRole('button', { name: 'Retry' })
    );
    await settle();
    // Back to be watched first: nothing went up.
    expect(
      within(card('Talk')).getByLabelText('Converted video')
    ).toBeInTheDocument();
    expect(publishes).toHaveLength(0);
    fireEvent.click(
      within(card('Talk')).getByRole('button', { name: 'Publish it' })
    );
    await settle();
    expect(publishes).toHaveLength(1);
  });

  it('keeps converting while videos wait to be checked, and says when it stops', async () => {
    renderWindow();
    await addVideos(file('A.mp4'), file('B.mp4'), file('C.mp4'), file('D.mp4'));
    await choose(
      'Category',
      'Other',
      screen.getByRole('group', { name: 'Same for all videos' })
    );
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Preview each converted video first/,
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert for Q-Tube (4)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    expect(within(card('B')).getByText(/^Converting/)).toBeInTheDocument();
    expect(
      screen.queryByText(/^Converted videos are waiting/)
    ).not.toBeInTheDocument();
    act(() => tool.finishJob('job-2'));
    await settle();
    act(() => tool.finishJob('job-3'));
    await settle();
    expect(within(card('D')).getByText('Waiting its turn')).toBeInTheDocument();
    // Said without counting: approved ones waiting to publish are held too.
    expect(
      screen.getByText(
        'Converted videos are waiting to be checked or published: the next one converts once one of them is published or discarded.'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      within(card('C')).getByRole('button', { name: 'Publish it' })
    );
    await settle();
    expect(within(card('D')).getByText(/^Converting/)).toBeInTheDocument();
    expect(publishes).toHaveLength(1);
  });

  it('asks for approval before the series goes up without a failed episode', async () => {
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
    act(() => tool.failJob('job-2', 'ffmpeg-failed'));
    await act(async () => publishes[0].resolve());
    await settle();
    expect(publishes).toHaveLength(1);

    const without = screen.getByRole('button', {
      name: 'Publish the series without them',
    });
    // Declined: the playlist isn't published.
    approvals.mockResolvedValueOnce(false);
    fireEvent.click(without);
    await settle();
    expect(publishes).toHaveLength(1);
    const asked = approvals.mock.calls[approvals.mock.calls.length - 1][0];
    // The playlist alone: one resource.
    expect(asked.resources).toHaveLength(1);
    expect(asked.fee).toBeCloseTo(0.01, 8);
    expect(
      screen.getByText(/Not published: the approval was declined/)
    ).toBeInTheDocument();

    // Retry asks again; accepted, it goes.
    fireEvent.click(
      within(screen.getByRole('region', { name: /^Series: / })).getByRole(
        'button',
        { name: 'Retry' }
      )
    );
    await settle();
    expect(publishes).toHaveLength(2);
    expect(publishes[1].steps.map((step) => step.kind)).toEqual(['playlist']);
  });

  it('brings files left out of a filled queue into view', async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderWindow();
      await addVideos(file('A.mp4'), file('B.mp4'));
      expect(scrollIntoView).not.toHaveBeenCalled();
      await addVideos(file('song.mp3'));
      const note = screen.getByText(/^Left out: song\.mp3/);
      expect(scrollIntoView).toHaveBeenCalled();
      expect(
        scrollIntoView.mock.contexts[scrollIntoView.mock.contexts.length - 1]
      ).toBe(note.closest('[role="alert"]'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('keeps the drop zone in view under a long published list', async () => {
    window.localStorage.setItem(
      'video-publisher-published-v1:Qaddress',
      JSON.stringify(
        Array.from({ length: 6 }, (_, index) => ({
          id: `item:${index}`,
          kind: 'qtube',
          publishedAt: 1_700_000_000_000 + index,
          record: {
            app: 'qtube',
            name: 'Tester',
            title: `Clip ${index}`,
            link: `qortal://APP/Q-Tube/video/Tester/qtube_vid_${index}`,
            open: { service: 'APP', name: 'Q-Tube', path: '/video' },
            resources: [
              {
                service: 'VIDEO',
                name: 'Tester',
                identifier: `qtube_vid_${index}`,
                kind: 'video',
              },
            ],
          },
        }))
      )
    );
    renderWindow();
    fireEvent.click(screen.getByRole('button', { name: 'Published (6)' }));
    // The list scrolls on its own, within part of the window.
    expect(screen.getByTestId('video-publisher-published-empty')).toHaveStyle({
      maxHeight: '45%',
      overflow: 'auto',
    });
    expect(screen.getByRole('button', { name: 'Choose videos' })).toBeVisible();
  });

  it('keeps a list of what was published, for Remove after Clear finished and a restart', async () => {
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
    // Collapsed, with a count.
    const heading = screen.getByRole('button', { name: 'Published (1)' });
    expect(heading).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    await settle();
    expect(screen.queryByRole('listitem', { name: 'Trip' })).toBeNull();

    // A restart: a new controller, the window again.
    cleanup();
    renderWindow();
    fireEvent.click(screen.getByRole('button', { name: 'Published (1)' }));
    const list = screen.getByRole('region', { name: 'Published videos' });
    const row = within(list).getByRole('listitem', { name: 'Trip' });
    expect(within(row).getByText(/^Q-Tube video · /)).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Open in Q-Tube' })
    ).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Copy link' }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringMatching(/^qortal:\/\/APP\/Q-Tube\/video\/Tester\//)
      )
    );
    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    const remove = await screen.findByRole('dialog', {
      name: 'Remove “Trip” from Q-Tube?',
    });
    expect(
      await within(remove).findByText('Fee: 0.02 QORT')
    ).toBeInTheDocument();
    fireEvent.click(
      within(remove).getByRole('button', { name: 'Remove from Q-Tube' })
    );
    await settle();
    expect(publishes[1].steps.map((step) => step.data)).toEqual([
      { base64: 'RA==' },
      { base64: 'RA==' },
    ]);
    await act(async () => publishes[1].resolve());
    await settle();
    expect(within(row).getByText('Removed from Q-Tube')).toBeInTheDocument();
    fireEvent.click(
      within(row).getByRole('button', { name: 'Take Trip off this list' })
    );
    expect(
      screen.queryByRole('button', { name: /^Published/ })
    ).not.toBeInTheDocument();
  });

  it('takes a published video off the list, where it stays published', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Published (1)' }));
    const list = screen.getByRole('region', { name: 'Published videos' });
    const row = within(list).getByRole('listitem', { name: 'Trip' });
    const take = within(row).getByRole('button', {
      name: 'Take Trip off this list',
    });
    fireEvent.mouseOver(take);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Take off this list. It stays on Q-Tube.'
    );
    fireEvent.click(take);
    await settle();
    expect(
      screen.queryByRole('button', { name: /^Published/ })
    ).not.toBeInTheDocument();
    // Nothing was replaced on QDN.
    expect(publishes).toHaveLength(1);
  });

  it('shows the signed-in account’s own published list', async () => {
    window.localStorage.setItem(
      'video-publisher-published-v1:Qother',
      JSON.stringify([
        {
          id: 'item:video-1',
          kind: 'film',
          publishedAt: 1_700_000_000_000,
          record: {
            app: 'subscreen',
            name: 'Other',
            title: 'Their Film',
            link: 'qortal://APP/Subscreen/film/Other/x',
            open: { service: 'APP', name: 'Subscreen', path: '/film/x' },
            resources: [
              {
                service: 'VIDEO',
                name: 'Other',
                identifier: 'x_video',
                kind: 'video',
              },
            ],
          },
        },
      ])
    );
    renderWindow();
    expect(
      screen.queryByRole('button', { name: /^Published/ })
    ).not.toBeInTheDocument();
    act(() =>
      store.set(userInfoAtom, {
        address: 'Qother',
        name: 'Other',
        publicKey: 'other',
      })
    );
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Published (1)' }));
    expect(
      screen.getByRole('listitem', { name: 'Their Film' })
    ).toBeInTheDocument();
  });

  it('says where subtitles go for Q-Share and Save to this PC', async () => {
    tool.probes.set(
      'Film.mkv',
      fakeProbe({
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'eng',
            isDefault: false,
            kind: 'text',
            isForced: false,
          },
          {
            index: 3,
            codec: 'hdmv_pgs_subtitle',
            language: 'eng',
            isDefault: false,
            kind: 'picture',
            isForced: false,
          },
        ],
      })
    );
    renderWindow();
    await addVideos(file('Film.mkv'));
    fireEvent.click(screen.getByRole('button', { name: 'Q-Share' }));
    expect(
      within(card('Film')).getByText(/Q-Share has no subtitle player/)
    ).toBeInTheDocument();
    expect(
      within(card('Film')).getByRole('button', { name: 'Add a subtitle file' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save to this PC' }));
    const film = card('Film');
    expect(
      within(film).getByText(/Subtitles aren't saved with the video/)
    ).toBeInTheDocument();
    expect(
      within(film).queryByRole('button', { name: 'Add a subtitle file' })
    ).not.toBeInTheDocument();
    expect(
      within(film).queryByRole('combobox', { name: /^Language of/ })
    ).not.toBeInTheDocument();
    // A picture track can still be burned in.
    fireEvent.click(
      within(film).getByRole('checkbox', { name: /Burn into the picture/ })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and save (1)' })
    );
    await settle();
    expect(vi.mocked(tool.startJob).mock.calls[0][0]).toMatchObject({
      burnSubtitleIndex: 3,
      subtitles: [],
    });
  });

  it('takes a click on Details while the file is still read, and keeps it open', async () => {
    const probe = tool.probe;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(tool).probe = vi.fn(async (sourceId: string) => {
      if (tool.sources.get(sourceId)?.name === 'B.mp4') await held;
      return probe(sourceId);
    });
    renderWindow();
    await act(async () => {
      fireEvent.change(screen.getByTestId('video-publisher-files'), {
        target: { files: [file('A.mp4'), file('B.mp4')] },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const details = within(card('B')).getByRole('button', {
      name: 'Details of B',
    });
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();
    expect(
      within(card('B')).getByRole('textbox', { name: 'Title' })
    ).toBeInTheDocument();

    // The window rebuilt (Home re-rendered it): still open.
    cleanup();
    render(
      <Provider store={store}>
        <ThemeProvider theme={lightTheme}>
          <VideoPublisher />
        </ThemeProvider>
      </Provider>
    );
    expect(
      within(card('B')).getByRole('textbox', { name: 'Title' })
    ).toBeInTheDocument();
  });

  it('needs a registered name to publish, but saves without one', async () => {
    renderWindow({ address: 'Qaddress', name: '', publicKey: 'pubkey' });
    await addVideos(file('Home.mov'));
    expect(
      screen.getByText(/Publishing needs a registered name/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Convert and publish to Q-Tube (1)' })
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save to this PC' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Convert and save (1)' })
    );
    await settle();
    act(() => tool.finishJob('job-1'));
    await settle();
    expect(tool.saveOutput).toHaveBeenCalledWith('job-1', 'Home.mp4');
    const home = card('Home');
    expect(within(home).getByText(/^Saved$/)).toBeInTheDocument();
    // Where it went, and buttons to play it or show it in its folder.
    expect(within(home).getByText('Saved to')).toBeInTheDocument();
    expect(
      within(home).getByTestId('video-publisher-saved-path')
    ).toHaveTextContent('/data/videos/job-1.mp4');
    fireEvent.click(within(home).getByRole('button', { name: 'Play' }));
    fireEvent.click(
      within(home).getByRole('button', { name: 'Show in folder' })
    );
    await settle();
    expect(tool.openSaved).toHaveBeenNthCalledWith(1, 'saved-job-1', 'open');
    expect(tool.openSaved).toHaveBeenNthCalledWith(2, 'saved-job-1', 'folder');
    // Moved since: said on the card.
    vi.mocked(tool.openSaved).mockRejectedValueOnce(
      new Error('[video-tool:saved-missing]')
    );
    fireEvent.click(within(home).getByRole('button', { name: 'Play' }));
    await settle();
    expect(within(home).getByRole('alert')).toHaveTextContent(
      'That file was moved or deleted since it was saved.'
    );
    // The run's own counts: converted, then saved.
    expect(screen.queryByText(/done$/)).not.toBeInTheDocument();
  });

  it('keeps the queue when the window is shown again', async () => {
    const first = renderWindow();
    await addVideos(file('Keep.mp4'));
    first.unmount();
    render(
      <Provider store={store}>
        <ThemeProvider theme={lightTheme}>
          <VideoPublisher />
        </ThemeProvider>
      </Provider>
    );
    expect(card('Keep')).toBeInTheDocument();
  });
});
