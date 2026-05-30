/**
 * Group Call V2 — Public API barrel
 *
 * This is the single import point for consumers of the new architecture.
 * All Phase 7 cutover wiring imports from here.
 */

// Spec (contracts and interfaces)
export * from './spec';

// Diagnostics
export * from './diagnosticsContract';

// Regression fixtures and analysis
export * from './regressionFixtures';

// Control plane
export { PeerHealthStream } from './peerHealthStream';
export {
  ReticulumSessionController,
  type TopologyEvent,
} from './reticulumSessionController';

// Data plane
export { PerSourcePcmRing } from './perSourcePcmRing';
export {
  ReceiveEngine,
  ReceiveEngineRegistry,
  type ReceiveEngineOptions,
  type TickInput,
  type TickOutput,
} from './receiveEngine';

// Policy plane
export {
  ReceivePolicyEngine,
  type ReceivePolicyConfig,
  DEFAULT_POLICY_CONFIG,
  type PolicyTickInput,
} from './receivePolicyEngine';
export {
  SendPressureController,
  type SendPressureConfig,
  DEFAULT_SEND_PRESSURE_CONFIG,
  type SendPressureSignal,
} from './sendPressureController';

// Decode service
export {
  WebCodecsDecodeService,
  NullDecodeService,
  createDecodeService,
  createDecodeServiceFactory,
  type IDecodeService,
  type DecodeServiceFactory,
} from './decodeService';

// Validation platform
export { ReplayHarness, type ReplayResult, type ReplayBarResult } from './replayHarness';
export {
  FaultInjector,
  FAULT_CALL63_PATTERN,
  FAULT_CALL60_PATTERN,
  type FaultSpec,
  type FaultKind,
} from './faultInjector';
export {
  PairedExportAnalyzer,
  extractMetricsFromV1Export,
  type PeerExportMetrics,
  type PeerClassification,
  type PairedAnalysisResult,
} from './pairedExportAnalyzer';
export {
  runGroupCallE2eScenario,
  buildLiveExportArtifactBundle,
  getGroupCallE2eScenario,
  selectGroupCallE2eScenarios,
  SENDER_PROFILE_PRESETS,
  GROUP_CALL_E2E_SCENARIOS,
  type SenderProfileId,
  type SenderImpairmentProfile,
  type GroupCallE2eScenario,
  type GroupCallE2eScenarioExpectation,
} from './groupCallE2eQuality';
export {
  buildGroupCallE2eArtifactBundle,
  buildMinimalTimelineSummary,
  type GroupCallE2eMode,
  type GroupCallE2eStage,
  type GroupCallE2ePeerTimelineSummary,
  type GroupCallE2ePeerArtifact,
  type GroupCallE2eReport,
  type GroupCallE2eArtifactBundle,
} from './groupCallE2eArtifacts';
