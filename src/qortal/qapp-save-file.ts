import FileSaver from 'file-saver';
import i18n from '../i18n/i18n';

// FileSaver initiates a browser download; it cannot confirm that the user has
// finished saving it. Propagate synchronous failures to the Q-App's reply port.
export async function showSaveFilePicker(
  { filename, blob }: { filename: string; blob: Blob },
  { setOpenSnackGlobal, setInfoSnackCustom }
) {
  try {
    if (!(blob instanceof Blob)) throw new Error('INVALID_BLOB');
    FileSaver.saveAs(blob, filename);
    setInfoSnackCustom({
      type: 'info',
      message: i18n.t('question:legacy_save.started'),
    });
    setOpenSnackGlobal(true);
  } catch (error) {
    const message = i18n.t('question:stream_save.failed');
    setInfoSnackCustom({ type: 'error', message });
    setOpenSnackGlobal(true);
    console.error('Error saving Q-App file:', error);
    throw new Error(message);
  }
}
