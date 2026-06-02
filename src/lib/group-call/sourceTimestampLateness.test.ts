import { expect, test } from 'vitest';
import {
  assessSourceTimestampLateness,
  type SourceTimestampLatenessState,
} from './sourceTimestampLateness';

const DEFAULT_OPTS = {
  maxExcessLatenessMs: 4_000,
  maxTimestampRegressionMs: 2_400,
};

test('accepts the first packet and seeds the baseline', () => {
  const result = assessSourceTimestampLateness(
    undefined,
    1_000,
    5_000,
    DEFAULT_OPTS
  );

  expect(result.shouldDrop).toBe(false);
  expect(result.nextState).toEqual({
    baselineSenderTimestampMs: 1_000,
    baselineReceivedAtMs: 5_000,
    maxAcceptedTimestampMs: 1_000,
  });
});

test('keeps fresh in-order packets even when baseline offset is non-zero', () => {
  const state: SourceTimestampLatenessState = {
    baselineSenderTimestampMs: 1_000,
    baselineReceivedAtMs: 5_000,
    maxAcceptedTimestampMs: 4_000,
  };

  const result = assessSourceTimestampLateness(
    state,
    4_500,
    8_650,
    DEFAULT_OPTS
  );

  expect(result.shouldDrop).toBe(false);
  expect(result.excessLatenessMs).toBe(150);
  expect(result.timestampRegressionMs).toBe(0);
  expect(result.nextState.maxAcceptedTimestampMs).toBe(4_500);
});

test('drops packets that regress too far behind accepted sender time', () => {
  const state: SourceTimestampLatenessState = {
    baselineSenderTimestampMs: 1_000,
    baselineReceivedAtMs: 5_000,
    maxAcceptedTimestampMs: 9_000,
  };

  const result = assessSourceTimestampLateness(
    state,
    6_500,
    7_000,
    DEFAULT_OPTS
  );

  expect(result.shouldDrop).toBe(true);
  expect(result.timestampRegressionMs).toBe(2_500);
  expect(result.nextState).toBe(state);
});

test('resyncs monotonic late packets instead of muting forever', () => {
  const state: SourceTimestampLatenessState = {
    baselineSenderTimestampMs: 1_000,
    baselineReceivedAtMs: 5_000,
    maxAcceptedTimestampMs: 9_000,
  };

  const result = assessSourceTimestampLateness(
    state,
    10_000,
    18_500,
    DEFAULT_OPTS
  );

  expect(result.shouldDrop).toBe(false);
  expect(result.excessLatenessMs).toBe(4_500);
  expect(result.nextState).toEqual({
    baselineSenderTimestampMs: 10_000,
    baselineReceivedAtMs: 18_500,
    maxAcceptedTimestampMs: 10_000,
  });
});

test('resyncs the baseline after prolonged stale-timestamp dropping', () => {
  const state: SourceTimestampLatenessState = {
    baselineSenderTimestampMs: 1_000,
    baselineReceivedAtMs: 5_000,
    maxAcceptedTimestampMs: 9_000,
  };

  const result = assessSourceTimestampLateness(
    state,
    6_500,
    14_500,
    DEFAULT_OPTS
  );

  expect(result.shouldDrop).toBe(false);
  expect(result.nextState).toEqual({
    baselineSenderTimestampMs: 6_500,
    baselineReceivedAtMs: 14_500,
    maxAcceptedTimestampMs: 6_500,
  });
});
