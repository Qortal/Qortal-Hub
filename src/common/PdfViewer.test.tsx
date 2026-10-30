import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfViewer } from './PdfViewer';
import { executeEvent } from '../utils/events';

vi.mock('../components/Desktop/CustomTitleBar', () => ({
  appHeighOffsetPx: '0px',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => vi.unstubAllGlobals());
describe('PDF reference lifetime', () => {
  it('revokes every replaced URL even when requests are batched, and revokes on close', () => {
    let id = 0;
    const create = vi.fn(() => `blob:test-${++id}`);
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      }
    );
    const view = render(<PdfViewer />);
    act(() => {
      for (let n = 0; n < 3; n++)
        executeEvent('openPdf', { blob: new Blob(['pdf']) });
    });
    expect(revoke.mock.calls).toEqual([['blob:test-1'], ['blob:test-2']]);
    expect(view.getByTitle('core:pdf_viewer').getAttribute('src')).toContain(
      'blob:test-3'
    );
    fireEvent.click(view.getByRole('button', { name: 'core:action.close' }));
    expect(revoke).toHaveBeenLastCalledWith('blob:test-3');
    view.unmount();
    expect(revoke).toHaveBeenCalledTimes(3);
    executeEvent('openPdf', { blob: new Blob(['unmounted']) });
    expect(create).toHaveBeenCalledTimes(3);
  });
  it('releases the remaining PDF when the viewer unmounts', () => {
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => 'blob:current';
        static revokeObjectURL = revoke;
      }
    );
    const view = render(<PdfViewer />);
    act(() => executeEvent('openPdf', { blob: new Blob(['pdf']) }));
    view.unmount();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:current');
  });
});
