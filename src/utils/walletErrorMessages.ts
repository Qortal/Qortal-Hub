import i18n from '../i18n/i18n';

export const getWalletFieldLabel = (field: string) =>
  i18n.t(`auth:wallet_errors.field.${field}`, {
    defaultValue: field,
  });

export const getMissingWalletFieldMessage = (field: string) => {
  if (field === 'encryptedSeed') {
    return i18n.t('auth:wallet_errors.missing_encrypted_seed', {
      postProcess: 'capitalizeFirstChar',
    });
  }

  return i18n.t('auth:wallet_errors.missing_field', {
    field: getWalletFieldLabel(field),
    postProcess: 'capitalizeFirstChar',
  });
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

export const getWalletErrorMessage = (error: unknown, fallback?: string) => {
  const resolvedFallback =
    fallback ??
    i18n.t('auth:wallet_errors.unable_to_unlock_default', {
      postProcess: 'capitalizeFirstChar',
    });

  const rawMessage = getRawErrorMessage(error).trim();
  const normalizedMessage = rawMessage.toLowerCase();

  if (!rawMessage) return resolvedFallback;

  if (normalizedMessage.includes('encryptedseed')) {
    return getMissingWalletFieldMessage('encryptedSeed');
  }

  if (
    normalizedMessage.includes('cannot read properties') ||
    normalizedMessage.includes('undefined is not an object') ||
    normalizedMessage.includes('null is not an object')
  ) {
    return i18n.t('auth:wallet_errors.account_incomplete', {
      postProcess: 'capitalizeFirstChar',
    });
  }

  if (
    normalizedMessage.includes('base58.decode') ||
    normalizedMessage.includes('base58 alphabet') ||
    normalizedMessage.includes('unacceptable input')
  ) {
    return i18n.t('auth:wallet_errors.invalid_security_data', {
      postProcess: 'capitalizeFirstChar',
    });
  }

  if (
    normalizedMessage.includes('missing its wallet') ||
    normalizedMessage.includes('missing its encrypted seed')
  ) {
    return rawMessage;
  }

  return rawMessage || resolvedFallback;
};

export const validateStoredWalletForDecrypt = (wallet: unknown) => {
  if (!wallet || typeof wallet !== 'object') {
    throw new Error(
      i18n.t('auth:wallet_errors.account_not_found', {
        postProcess: 'capitalizeFirstChar',
      })
    );
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
