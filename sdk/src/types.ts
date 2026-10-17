export type AdapterAction = {
  id?: string;
  kind?: string;
  label?: string;
  params?: Record<string, unknown>;
  note?: string;
};

export type AdapterBudget = {
  maxIterations?: number;
  maxTotalMs?: number;
  maxAttemptMs?: number;
};

export type AdapterPolicy = {
  thresholds?: Record<string, number>;
  gate?: {
    mode?: "hard-only" | "all" | string;
    unknownAsFail?: boolean;
    minLadderTier?: "diagnostic" | "reduced-order" | "certified";
  };
};

export type AdapterMode = "gr" | "constraint-pack";

export type AdapterConstraintPack = {
  id: string;
  customerId?: string;
  policyProfileId?: string;
  policyOverride?: ConstraintPackOverride;
  telemetry?: Record<string, unknown>;
  metrics?: Record<string, number | boolean | string | null>;
  certificate?: ConstraintPackCertificateResult;
  deltas?: TrainingTraceDelta[];
  notes?: string[];
  proxy?: boolean;
  ladderTier?: "diagnostic" | "reduced-order" | "certified";
  autoTelemetry?: boolean;
  telemetryPath?: string;
  junitPath?: string;
  vitestPath?: string;
  jestPath?: string;
  eslintPath?: string;
  tscPath?: string;
  toolLogTraceId?: string;
  toolLogWindowMs?: number;
  toolLogLimit?: number;
};

export type AdapterRunRequest = {
  traceId?: string;
  mode?: AdapterMode;
  pack?: AdapterConstraintPack;
  actions?: AdapterAction[];
  budget?: AdapterBudget;
  policy?: AdapterPolicy;
};

export type TrainingTraceConstraint = {
  id: string;
  severity?: string;
  status?: string;
  value?: number | null;
  limit?: string | null;
  note?: string;
};

export type TrainingTraceDelta = {
  key: string;
  from?: number | null;
  to?: number | null;
  delta?: number;
  unit?: string;
  change?: "added" | "removed" | "changed";
};

export type TrainingTraceMetricValue = number | boolean | string | null;

export type TrainingTraceMetrics = Record<string, TrainingTraceMetricValue>;

export type AdapterArtifactRef = {
  kind: string;
  ref: string;
  label?: string;
};

export type RuntimeClaimTier = "diagnostic" | "reduced-order" | "certified";

export type AdapterRuntimeEnvelopeMetadata = {
  claim_tier?: RuntimeClaimTier | string;
  provenance?: string;
  certifying?: boolean;
};

export type NormalizedAdapterRuntimeEnvelopeMetadata = {
  claim_tier: RuntimeClaimTier;
  provenance: string;
  certifying: boolean;
};

export type AdapterRunResponse = {
  traceId?: string;
  runId: string;
  verdict: "PASS" | "FAIL";
  pass: boolean;
  firstFail?: TrainingTraceConstraint | null;
  deltas: TrainingTraceDelta[];
  artifacts: AdapterArtifactRef[];
  metadata?: AdapterRuntimeEnvelopeMetadata;
};

export type TrainingTraceSource = {
  system?: string;
  component?: string;
  tool?: string;
  version?: string;
  proxy?: boolean;
};

export type PolicyLadder = {
  tier: "diagnostic" | "reduced-order" | "certified";
  policy?: string;
  policyVersion?: string;
};

export type TrainingTraceSignal = {
  kind?: string;
  proxy?: boolean;
  ladder?: PolicyLadder;
};

export type TrainingTraceCertificate = {
  status?: string;
  certificateHash: string | null;
  certificateId?: string | null;
  integrityOk?: boolean;
};

export type TrainingTraceRecord = {
  kind: "training-trace";
  version: number;
  id: string;
  seq: number;
  ts: string;
  traceId?: string;
  tenantId?: string;
  source?: TrainingTraceSource;
  signal?: TrainingTraceSignal;
  pass: boolean;
  deltas: TrainingTraceDelta[];
  metrics?: TrainingTraceMetrics;
  firstFail?: TrainingTraceConstraint;
  certificate?: TrainingTraceCertificate;
  notes?: string[];
};

export type ConstraintPackPolicy = {
  mode?: "hard-only" | "all" | string;
  unknownAsFail?: boolean;
  minLadderTier?: "diagnostic" | "reduced-order" | "certified";
};

export type ConstraintPackCertificatePolicy = {
  admissibleStatus?: string;
  allowMarginalAsViable?: boolean;
  treatMissingCertificateAsNotCertified?: boolean;
};

export type ConstraintPackConstraint = {
  id: string;
  label?: string;
  severity?: "HARD" | "SOFT" | string;
  min?: number;
  max?: number;
  band?: { min: number; max: number };
  note?: string;
  unit?: string;
};

export type ConstraintPackSignalKinds = {
  diagnostic: string;
  certified: string;
};

export type ConstraintPack = {
  id: string;
  name: string;
  description?: string;
  version: number;
  policy: ConstraintPackPolicy;
  certificate: ConstraintPackCertificatePolicy;
  constraints: ConstraintPackConstraint[];
  proxies?: ConstraintPackConstraint[];
  signalKinds: ConstraintPackSignalKinds;
  artifacts?: { metricsRef?: string; reportRef?: string };
};

export type ConstraintPackConstraintOverride = {
  id: string;
  min?: number;
  max?: number;
  band?: { min: number; max: number };
  severity?: "HARD" | "SOFT" | string;
  note?: string;
  unit?: string;
};

export type ConstraintPackOverride = {
  packId?: string;
  policy?: ConstraintPackPolicy;
  certificate?: ConstraintPackCertificatePolicy;
  constraints?: ConstraintPackConstraintOverride[];
  proxies?: ConstraintPackConstraintOverride[];
};

export type ConstraintPackPolicyProfile = {
  id: string;
  customerId: string;
  name?: string;
  description?: string;
  version: number;
  packs: ConstraintPackOverride[];
  createdAt: string;
  updatedAt: string;
};

export type ConstraintPackPolicyProfileInput = {
  id?: string;
  customerId: string;
  name?: string;
  description?: string;
  version?: number;
  packs: ConstraintPackOverride[];
};

export type ConstraintPackConstraintResult = {
  id: string;
  severity?: "HARD" | "SOFT" | string;
  status?: "pass" | "fail" | "unknown" | string;
  value?: number | null;
  limit?: string | number | null;
  proxy?: boolean;
  note?: string;
};

export type ConstraintPackCertificateResult = {
  status?: string;
  certificateHash?: string | null;
  certificateId?: string | null;
  integrityOk?: boolean;
};

export type ConstraintPackEvaluation = {
  pass?: boolean;
  constraints?: ConstraintPackConstraintResult[];
  certificate?: ConstraintPackCertificateResult;
  deltas?: TrainingTraceDelta[];
  firstFail?: ConstraintPackConstraintResult;
  notes?: string[];
  proxy?: boolean;
  ladderTier?: "diagnostic" | "reduced-order" | "certified";
};

export type ConstraintPackEvaluateRequest = {
  traceId?: string;
  customerId?: string;
  policyProfileId?: string;
  policyOverride?: ConstraintPackOverride;
  telemetry?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  certificate?: ConstraintPackCertificateResult;
  deltas?: TrainingTraceDelta[];
  notes?: string[];
  proxy?: boolean;
  ladderTier?: "diagnostic" | "reduced-order" | "certified";
};

export type ConstraintPackEvaluateResponse = {
  pack: ConstraintPack;
  policyProfile?: {
    id: string;
    customerId: string;
    version: number;
    name?: string;
  };
  evaluation: ConstraintPackEvaluation;
  trace: TrainingTraceRecord;
};
