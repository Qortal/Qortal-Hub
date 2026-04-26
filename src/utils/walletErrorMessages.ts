const WALLET_FIELD_LABELS: Record<string, string> = {
  address0: 'wallet address',
  encryptedSeed: 'encrypted seed (the locked wallet data needed to unlock it)',
  iv: 'wallet encryption data',
  kdfThreads: 'wallet password settings',
  mac: 'wallet integrity check',
  salt: 'wallet password security data',
  version: 'wallet version',
};

const MISSING_WALLET_MESSAGE =
  'This saved account could not be found. Choose another account or restore this wallet from a backup.';

const INCOMPLETE_WALLET_MESSAGE =
  'This saved account looks incomplete or damaged. Choose another account or restore this wallet from a backup.';

const INVALID_WALLET_DATA_MESSAGE =
  'This saved account contains invalid wallet security data. Choose another account or restore this wallet from a backup.';

export const getWalletFieldLabel = (field: string) =>
  WALLET_FIELD_LABELS[field] || field;

export const getMissingWalletFieldMessage = (field: string) => {
  if (field === 'encryptedSeed') {
    return 'This saved account is missing its encrypted seed (the locked wallet data needed to unlock it). Choose another account or restore this wallet from a backup.';
  }

  return `This saved account is missing its ${getWalletFieldLabel(
    field
  )}. Choose another account or restore this wallet from a backup.`;
};

const getRawErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }

  return '';
};

export const getWalletErrorMessage = (
  error: unknown,
  fallback = 'Unable to unlock this wallet.'
) => {
  const rawMessage = getRawErrorMessage(error).trim();
  const normalizedMessage = rawMessage.toLowerCase();

  if (!rawMessage) return fallback;

  if (normalizedMessage.includes('encryptedseed')) {
    return getMissingWalletFieldMessage('encryptedSeed');
  }

  if (
    normalizedMessage.includes('cannot read properties') ||
    normalizedMessage.includes('undefined is not an object') ||
    normalizedMessage.includes('null is not an object')
  ) {
    return INCOMPLETE_WALLET_MESSAGE;
  }

  if (
    normalizedMessage.includes('base58.decode') ||
    normalizedMessage.includes('base58 alphabet') ||
    normalizedMessage.includes('unacceptable input')
  ) {
    return INVALID_WALLET_DATA_MESSAGE;
  }

  if (
    normalizedMessage.includes('missing its wallet') ||
    normalizedMessage.includes('missing its encrypted seed')
  ) {
    return rawMessage;
  }

  return rawMessage || fallback;
};

export const validateStoredWalletForDecrypt = (wallet: unknown) => {
  if (!wallet || typeof wallet !== 'object') {
    throw new Error(MISSING_WALLET_MESSAGE);
  }

  const requiredFields = ['encryptedSeed', 'iv', 'salt', 'mac'];
  const walletRecord = wallet as Record<string, unknown>;

  for (const field of requiredFields) {
    if (
      typeof walletRecord[field] !== 'string' ||
      walletRecord[field].trim().length === 0
    ) {
      throw new Error(getMissingWalletFieldMessage(field));
    }
  }
};
