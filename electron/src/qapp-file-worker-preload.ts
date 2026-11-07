import { ipcRenderer } from 'electron';
import { attachQAppFileExecutor } from './qapp-file-executor';
import { QAPP_FILE_WORKER_URL } from './qapp-file-protocol';

if (!process.isMainFrame || window.location.href !== QAPP_FILE_WORKER_URL)
  throw new Error('QAPP_FILE_WORKER_ORIGIN');

const tasks = new Map<string, () => void>();
let tail = Promise.resolve();
ipcRenderer.on('qappFiles:attach', (event, { id, bytes, files }) => {
  if (tasks.has(id) || tasks.size >= 8 || event.ports.length !== 2) {
    for (const port of event.ports) port.close();
    ipcRenderer.send('qappFiles:released', id);
    return;
  }
  const [input, control] = event.ports;
  const dispose = attachQAppFileExecutor(
    input,
    control,
    { bytes, files },
    {
      schedule: (run) => {
        const result = tail.then(run);
        tail = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      },
      save: async (blob, filename, signal) => {
        if (signal.aborted) throw new Error('QAPP_FILE_CLOSED');
        const url = URL.createObjectURL(blob);
        const cancel = () => ipcRenderer.send('qappFiles:cancelSave', id);
        signal.addEventListener('abort', cancel, { once: true });
        try {
          await ipcRenderer.invoke('qappFiles:save', id, url, filename);
        } finally {
          signal.removeEventListener('abort', cancel);
          URL.revokeObjectURL(url);
        }
      },
      released: (completed) => {
        tasks.delete(id);
        ipcRenderer.send('qappFiles:released', id, completed);
      },
      fault: () => ipcRenderer.send('qappFiles:fault'),
    }
  );
  tasks.set(id, dispose);
});
ipcRenderer.on('qappFiles:cancel', (_event, id) => tasks.get(id)?.());
window.addEventListener('pagehide', () => {
  for (const dispose of tasks.values()) dispose();
});
