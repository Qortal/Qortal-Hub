import { describe, expect, it } from 'vitest';
import {
  codedQortalRequestError,
  serializeQortalRequestError,
  USER_DECLINED_REQUEST_CODE,
} from './qortal-request-errors';

describe('Q-App request errors', () => {
  it('preserves a stable code separately from its localized message', () => {
    const error = codedQortalRequestError(
      USER_DECLINED_REQUEST_CODE,
      'Localized decline message'
    );

    expect(serializeQortalRequestError(error)).toEqual({
      error: USER_DECLINED_REQUEST_CODE,
      code: USER_DECLINED_REQUEST_CODE,
      message: 'Localized decline message',
    });
  });

  it('keeps uncoded failures backward compatible', () => {
    expect(
      serializeQortalRequestError(new Error('Network unavailable'))
    ).toEqual({
      error: 'Network unavailable',
      message: 'Network unavailable',
    });
  });
});
