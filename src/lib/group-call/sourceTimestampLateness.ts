export interface SourceTimestampLatenessState {
  readonly baselineSenderTimestampMs: number;
  readonly baselineReceivedAtMs: number;
  readonly maxAcceptedTimestampMs: number;
}

export interface SourceTimestampLatenessOptions {
  readonly maxExcessLatenessMs: number;
  readonly maxTimestampRegressionMs: number;
}

export interface SourceTimestampLatenessAssessment {
  readonly nextState: SourceTimestampLatenessState;
  readonly shouldDrop: boolean;
  readonly excessLatenessMs: number;
  readonly timestampRegressionMs: number;
}

export function assessSourceTimestampLateness(
  state: SourceTimestampLatenessState | undefined,
  senderTimestampMs: number,
  receivedAtMs: number,
  opts: SourceTimestampLatenessOptions
): SourceTimestampLatenessAssessment {
  const normalizedSenderTimestampMs = Math.max(0, senderTimestampMs);
  const normalizedReceivedAtMs = Math.max(0, receivedAtMs);

  if (!state) {
    return {
      nextState: {
        baselineSenderTimestampMs: normalizedSenderTimestampMs,
        baselineReceivedAtMs: normalizedReceivedAtMs,
        maxAcceptedTimestampMs: normalizedSenderTimestampMs,
      },
      shouldDrop: false,
      excessLatenessMs: 0,
      timestampRegressionMs: 0,
    };
  }

  const senderDeltaMs =
    normalizedSenderTimestampMs - state.baselineSenderTimestampMs;
  const receivedDeltaMs =
    normalizedReceivedAtMs - state.baselineReceivedAtMs;
  const excessLatenessMs = Math.max(0, receivedDeltaMs - senderDeltaMs);
  const timestampRegressionMs = Math.max(
    0,
    state.maxAcceptedTimestampMs - normalizedSenderTimestampMs
  );
  const shouldDrop =
    excessLatenessMs > opts.maxExcessLatenessMs ||
    timestampRegressionMs > opts.maxTimestampRegressionMs;
  const monotonicForwardProgress =
    normalizedSenderTimestampMs >= state.maxAcceptedTimestampMs;
  const senderAdvancedPastBaseline =
    normalizedSenderTimestampMs >= state.baselineSenderTimestampMs;
  const baselineAgeMs = Math.max(
    0,
    normalizedReceivedAtMs - state.baselineReceivedAtMs
  );
  const shouldResyncLateBaseline =
    shouldDrop &&
    (
      (timestampRegressionMs === 0 && monotonicForwardProgress) ||
      (baselineAgeMs > opts.maxExcessLatenessMs &&
        senderAdvancedPastBaseline)
    );

  return {
    nextState: shouldResyncLateBaseline
      ? {
          baselineSenderTimestampMs: normalizedSenderTimestampMs,
          baselineReceivedAtMs: normalizedReceivedAtMs,
          maxAcceptedTimestampMs: normalizedSenderTimestampMs,
        }
      : shouldDrop
        ? state
      : {
          ...state,
          maxAcceptedTimestampMs: Math.max(
            state.maxAcceptedTimestampMs,
            normalizedSenderTimestampMs
          ),
        },
    shouldDrop: shouldResyncLateBaseline ? false : shouldDrop,
    excessLatenessMs,
    timestampRegressionMs,
  };
}
