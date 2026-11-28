import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import { createFakeVideoTool } from '../../test/mocks/videoTool';
import { filesFromDrop } from './dropFiles';
import { videoQueueAtom } from './videoPublisherAtoms';
import { VideoPublisherController } from './videoPublisherController';

/**
 * Chromium's entries for a dropped folder. A File read from an entry has no
 * webkitRelativePath (only a folder <input> sets it); where it was is the
 * entry's fullPath.
 */
const fileEntry = (name: string, folder: string) => {
  const file = new File(['x'], name);
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `${folder}/${name}`,
    file: (resolve: (file: File) => void) => resolve(file),
  };
};

const folderEntry = (name: string, parent: string, children: unknown[]) => ({
  isFile: false,
  isDirectory: true,
  name,
  fullPath: `${parent}/${name}`,
  createReader: () => {
    let read = false;
    return {
      readEntries: (resolve: (entries: unknown[]) => void) => {
        resolve(read ? [] : children);
        read = true;
      },
    };
  },
});

describe('a series folder dropped on the window', () => {
  it('keeps each season apart, as the same folder picked through the dialog', async () => {
    const show = folderEntry('Show', '', [
      folderEntry('Season 1', '/Show', [
        fileEntry('E01.mkv', '/Show/Season 1'),
        fileEntry('E01.en.srt', '/Show/Season 1'),
      ]),
      folderEntry('Season 2', '/Show', [
        fileEntry('E01.mkv', '/Show/Season 2'),
        fileEntry('E01.en.srt', '/Show/Season 2'),
      ]),
    ]);
    const transfer = {
      items: [{ kind: 'file', webkitGetAsEntry: () => show }],
      files: [],
      types: ['Files'],
    } as unknown as DataTransfer;

    /** The queue after adding these files, as the window adds them. */
    const queued = async (
      files: File[],
      relativePaths?: (string | undefined)[]
    ) => {
      const tool = createFakeVideoTool();
      const store = createStore();
      const controller = new VideoPublisherController({
        store,
        bridge: () => tool,
        isPublicNode: async () => false,
      });
      try {
        await controller.addFiles(files, relativePaths);
        const items = store.get(videoQueueAtom);
        return {
          seasons: items.map((item) => item.fields.season),
          subtitles: items.map((item) =>
            item.subtitles.map(
              (track) => tool.sources.get(track.sourceId)?.relativePath
            )
          ),
        };
      } finally {
        controller.dispose();
      }
    };

    // The folder picked (a folder <input>, or main's own dialog): each file
    // says where it was.
    const picked = (relativePath: string) => {
      const file = new File(['x'], relativePath.split('/').pop());
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath,
      });
      return file;
    };
    const asPicked = {
      seasons: [1, 2],
      subtitles: [['Show/Season 1/E01.en.srt'], ['Show/Season 2/E01.en.srt']],
    };
    expect(
      await queued([
        picked('Show/Season 1/E01.mkv'),
        picked('Show/Season 1/E01.en.srt'),
        picked('Show/Season 2/E01.mkv'),
        picked('Show/Season 2/E01.en.srt'),
      ])
    ).toEqual(asPicked);

    // The same folder dropped: each episode should know its season and have
    // its own season's subtitle.
    const dropped = await filesFromDrop(transfer);
    expect(await queued(dropped.files, dropped.relativePaths)).toEqual(
      asPicked
    );
  });
});
