import type { FindingSeverity } from '../advisor/types';

/** Where the analysis request is sent. */
export type AiProviderId = 'anthropic' | 'openai-compat' | 'agent';

/**
 * Togglable context sections shown in the pre-send review dialog.
 * The plan table (and, for compare, the digest) is always included and is
 * not part of this union.
 */
export type AiSectionId =
  | 'sql'
  | 'predicates'
  | 'notes'
  | 'binds'
  | 'monitorMeta'
  | 'ash'
  | 'signals'
  | 'advisor'
  | 'metadata';

/** One togglable block of the outgoing user message. */
export interface ContextSection {
  id: AiSectionId;
  label: string;
  text: string;
  charCount: number;
  included: boolean;
}

/** The assembled user message plus the sections it was built from. */
export interface BuiltContext {
  /** Always-included core: plan table (analyze) or both tables + digest (compare). */
  core: string;
  sections: ContextSection[];
  userMessage: string;
  tokenEstimate: number;
}

/** A structured finding parsed from the model's trailing JSON block. */
export interface AiFinding {
  severity: FindingSeverity;
  title: string;
  explanation: string;
  suggestion?: string;
  nodeIds: number[];
}

export type AiReportKind = 'analyze' | 'compare';

export interface AiReport {
  kind: AiReportKind;
  markdown: string;
  findings: AiFinding[] | null;
  provider: AiProviderId;
  model: string;
  createdAt: number;
  /** Plan slot indices the report was generated from. */
  slotIds: number[];
  /** True when the response was cut off by max_tokens. */
  truncated: boolean;
}

export type AiStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'other';

export type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason: AiStopReason; refusalExplanation?: string };

export interface AiRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
}

export type AiErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'overloaded'
  | 'network'
  | 'refusal'
  | 'bad-request'
  | 'aborted'
  | 'unknown';

export class AiError extends Error {
  kind: AiErrorKind;
  status: number | null;

  constructor(kind: AiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
  }
}
