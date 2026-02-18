/**
 * Asks the main process to decrypt group-encrypted data.
 */
export const decryptResource = async (
  data: string,
  fromQortalRequest?: boolean
): Promise<unknown> => {
  try {
    return new Promise((res, rej) => {
      window
        .sendMessage('decryptGroupEncryption', {
          data,
        })
        .then((response: { error?: string }) => {
          if (!response?.error) {
            res(response);
            return;
          }
          if (fromQortalRequest) {
            rej({ error: response.error, message: response?.error });
          } else {
            rej(response.error);
          }
        })
        .catch((error: Error) => {
          if (fromQortalRequest) {
            rej({
              message: error.message || 'An error occurred',
              error: error.message || 'An error occurred',
            });
          } else {
            rej(error.message || 'An error occurred');
          }
        });
    });
  } catch (error) {
    console.log(error);
  }
};

/**
 * Sends group data (e.g. announcements, thread messages) to the main process to store.
 */
export const addDataPublishesFunc = async (
  data: string | Record<string, unknown>,
  groupId: string,
  type: string
): Promise<unknown> => {
  try {
    return new Promise((res, rej) => {
      window
        .sendMessage('addDataPublishes', {
          data,
          groupId,
          type,
        })
        .then((response: { error?: string }) => {
          if (!response?.error) {
            res(response);
            return;
          }
          rej(response.error);
        })
        .catch((error: Error) => {
          rej(error.message || 'An error occurred');
        });
    });
  } catch (error) {
    console.log(error);
  }
};

/**
 * Retrieves stored group data (e.g. announcements, thread messages) from the main process.
 */
export const getDataPublishesFunc = async (
  groupId: string,
  type: string
): Promise<unknown> => {
  try {
    return new Promise((res, rej) => {
      window
        .sendMessage('getDataPublishes', {
          groupId,
          type,
        })
        .then((response: { error?: string }) => {
          if (!response?.error) {
            res(response);
            return;
          }
          rej(response.error);
        })
        .catch((error: Error) => {
          rej(error.message || 'An error occurred');
        });
    });
  } catch (error) {
    console.log(error);
  }
};
