import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'fs';

export function registerMainWindowWalletStorage({
  ipcMain,
  checkSender,
  getFilePath,
  onError,
}: {
  ipcMain: Pick<IpcMain, 'handle'>;
  checkSender: (event: IpcMainInvokeEvent) => void;
  getFilePath: () => Promise<string>;
  onError: (error: unknown) => void;
}): void {
  const check = (event: IpcMainInvokeEvent, fileName: unknown) => {
    checkSender(event);
    if (fileName !== 'wallet-storage.json') {
      throw new Error('Invalid wallet storage file');
    }
  };
  ipcMain.handle('walletStorage:read', async (event, fileName) => {
    check(event, fileName);
    const filePath = await getFilePath();
    check(event, fileName);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') onError(error);
      return null;
    }
  });
  ipcMain.handle('walletStorage:write', async (event, fileName, contents) => {
    check(event, fileName);
    if (typeof contents !== 'string')
      throw new Error('Invalid wallet storage data');
    const filePath = await getFilePath();
    check(event, fileName);
    await fs.writeFile(filePath, contents, 'utf8');
    return true;
  });
}
