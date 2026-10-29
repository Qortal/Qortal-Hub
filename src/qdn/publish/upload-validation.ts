import i18n from '../../i18n/i18n';

export function requirePublishFile(value: unknown): asserts value is Blob {
  if (!(value instanceof Blob)) {
    throw new Error(i18n.t('question:publish_validation.invalid_file'));
  }
}

export async function checkPublishStorage(
  totalSize: number,
  createEndpoint: (path: string) => Promise<string>
) {
  if (!Number.isSafeInteger(totalSize) || totalSize < 0) {
    throw new Error(i18n.t('question:publish_validation.invalid_file'));
  }
  const endpoint = await createEndpoint(
    `/arbitrary/check/tmp?totalSize=${totalSize}`
  );
  const response = await fetch(endpoint);
  if (!response.ok) {
    // A failed precheck can also be an invalid request, authorization failure,
    // or service error. Its HTTP status alone does not establish a full disk.
    throw new Error(
      i18n.t('question:publish_validation.storage_check_failed', {
        status: response.status,
      })
    );
  }
}
