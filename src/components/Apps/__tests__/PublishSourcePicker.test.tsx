import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

// The key, with the values it was given, so a test can see both.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const values = Object.entries(options ?? {})
        .filter(([name]) => name !== 'postProcess')
        .map(([name, value]) => `${name}=${value}`);
      return [key, ...values].join(' ');
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
  }),
}));

import { PublishSourcePicker } from '../PublishSourcePicker';
import type { PublishSource } from '../publishSource';
import { installPublishBridges } from '../../../test/mocks/publishBridges';

const SAVED_FOLDER = '/home/dev/q-notes/dist';
const LAST_READ = Date.UTC(2026, 10, 2, 12);
const MB = 1024 * 1024;

const renderPicker = (
  props: Partial<Parameters<typeof PublishSourcePicker>[0]> = {}
) => {
  const onChange = vi.fn();
  const onError = vi.fn();
  const view = render(
    <ThemeProvider theme={createTheme()}>
      <PublishSourcePicker
        maxSize={50 * MB}
        onChange={onChange}
        onError={onError}
        source={null}
        {...props}
      />
    </ThemeProvider>
  );
  return { ...view, onChange, onError };
};

describe('PublishSourcePicker', () => {
  let bridges: ReturnType<typeof installPublishBridges>;

  beforeEach(() => {
    bridges = installPublishBridges();
  });

  afterEach(() => {
    bridges.uninstall();
  });

  it('offers only a zip file in the browser', () => {
    bridges.uninstall();
    renderPicker({
      savedSource: { path: SAVED_FOLDER, kind: 'folder' },
    });
    expect(screen.getByText('core:action.choose_file')).toBeInTheDocument();
    expect(
      screen.queryByText('core:publish_source.choose_folder')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('core:publish_source.same_folder')
    ).not.toBeInTheDocument();
  });

  it('names each info button after its choice and reads out its text', () => {
    renderPicker();
    const fileInfo = screen.getByRole('button', {
      name: 'core:publish_source.info_about choice=core:action.choose_file',
    });
    expect(fileInfo).toHaveAccessibleDescription(
      'core:publish_source.info_file size=50'
    );
    expect(
      screen.getByRole('button', {
        name: 'core:publish_source.info_about choice=core:publish_source.choose_folder',
      })
    ).toHaveAccessibleDescription('core:publish_source.info_folder');
  });

  it('reopens the folder picker at the saved path and shows what changed', async () => {
    const user = userEvent.setup();
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([80, 75, 3, 4]),
      directoryPath: SAVED_FOLDER,
      changedFiles: 3,
    });
    const { onChange, rerender } = renderPicker({
      changedSince: LAST_READ,
      savedSource: { path: SAVED_FOLDER, kind: 'folder', takenAt: LAST_READ },
    });

    expect(screen.getByText(SAVED_FOLDER)).toBeInTheDocument();
    await user.click(screen.getByText('core:publish_source.same_folder'));

    expect(bridges.electron.selectAndZipDirectory).toHaveBeenCalledWith(
      undefined,
      { defaultPath: SAVED_FOLDER, changedSince: LAST_READ }
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const picked: PublishSource = onChange.mock.calls[0][0];
    expect(picked).toEqual(
      expect.objectContaining({
        kind: 'folder',
        name: 'dist',
        path: SAVED_FOLDER,
        changedFiles: 3,
      })
    );
    expect(picked.file.name).toBe('dist.zip');
    expect(picked.file.size).toBe(4);

    rerender(
      <ThemeProvider theme={createTheme()}>
        <PublishSourcePicker
          changedSince={LAST_READ}
          maxSize={50 * MB}
          onChange={onChange}
          onError={vi.fn()}
          savedSource={{ path: SAVED_FOLDER, kind: 'folder' }}
          source={picked}
        />
      </ThemeProvider>
    );
    expect(
      screen.getByText('core:publish_source.selected_folder name=dist')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /^core:publish_source\.changed_files date=.*2026 number=3$/
      )
    ).toBeInTheDocument();
  });

  it('reopens the zip picker at the saved zip', async () => {
    const user = userEvent.setup();
    bridges.electron.selectFile.mockResolvedValue('/home/dev/q-notes.zip');
    bridges.electron.readFile.mockResolvedValue(new Uint8Array([1, 2]));
    const { onChange } = renderPicker({
      savedSource: { path: '/home/dev/q-notes.zip', kind: 'zip' },
    });

    await user.click(screen.getByText('core:publish_source.same_file'));

    expect(bridges.electron.selectFile).toHaveBeenCalledWith({
      defaultPath: '/home/dev/q-notes.zip',
    });
    expect(bridges.electron.readFile).toHaveBeenCalledWith(
      '/home/dev/q-notes.zip'
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'zip',
          name: 'q-notes.zip',
          path: '/home/dev/q-notes.zip',
          changedFiles: null,
        })
      )
    );
  });

  it('lets You choose another folder, counting changes since the last publish', async () => {
    const user = userEvent.setup();
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array([1]),
      directoryPath: '/home/dev/other',
      changedFiles: 0,
    });
    const { onChange } = renderPicker({
      changedSince: LAST_READ,
      savedSource: { path: SAVED_FOLDER, kind: 'folder' },
    });

    await user.click(screen.getByText('core:publish_source.choose_another'));
    expect(
      screen.queryByText('core:publish_source.same_folder')
    ).not.toBeInTheDocument();
    expect(screen.getByText('core:action.choose_file')).toBeInTheDocument();
    await user.click(screen.getByText('core:publish_source.choose_folder'));

    expect(bridges.electron.selectAndZipDirectory).toHaveBeenCalledWith(
      undefined,
      { changedSince: LAST_READ }
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/home/dev/other', changedFiles: 0 })
      )
    );
  });

  it('keeps the form as it was when the picker is cancelled', async () => {
    const user = userEvent.setup();
    const { onChange, onError } = renderPicker({
      savedSource: { path: SAVED_FOLDER, kind: 'folder' },
    });
    await user.click(screen.getByText('core:publish_source.same_folder'));
    await waitFor(() =>
      expect(bridges.electron.selectAndZipDirectory).toHaveBeenCalled()
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('refuses a folder that zips to more than the limit', async () => {
    const user = userEvent.setup();
    bridges.electron.selectAndZipDirectory.mockResolvedValue({
      buffer: new Uint8Array(2 * MB),
      directoryPath: '/home/dev/huge',
    });
    const { onChange, onError } = renderPicker({ maxSize: 1 * MB });

    await user.click(screen.getByText('core:publish_source.choose_folder'));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        'core:message.error.file_too_large filename=huge size=1'
      )
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says so when the folder or file cannot be read', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    bridges.electron.selectAndZipDirectory.mockRejectedValue(
      new Error('EACCES')
    );
    const { onError } = renderPicker();

    await user.click(screen.getByText('core:publish_source.choose_folder'));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('core:publish_source.read_error')
    );
  });
});
