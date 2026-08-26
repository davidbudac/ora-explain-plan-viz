/**
 * Provider dispatch for AI plan analysis streaming.
 *
 * Routes an AiRequest to the configured provider implementation and
 * validates that the config carries what that provider needs.
 */

import type { AgentConfig } from '../agent/client';
import type { AiProviderId, AiRequest, AiStreamEvent } from './types';
import { AiError } from './types';
import { streamAnthropic } from './providers/anthropic';
import { streamOpenAiCompat } from './providers/openaiCompat';
import { streamAgentProxy } from './providers/agent';

/** Resolved, ready-to-run configuration for one analysis request. */
export interface AiRunConfig {
  provider: AiProviderId;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  agent?: AgentConfig;
}

export function streamAnalysis(
  runConfig: AiRunConfig,
  req: AiRequest,
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  switch (runConfig.provider) {
    case 'anthropic': {
      if (!runConfig.apiKey) {
        throw new AiError('bad-request', 'Anthropic API key is not configured');
      }
      return streamAnthropic({ apiKey: runConfig.apiKey }, req, signal);
    }
    case 'openai-compat': {
      if (!runConfig.baseUrl) {
        throw new AiError('bad-request', 'OpenAI-compatible base URL is not configured');
      }
      return streamOpenAiCompat(
        { baseUrl: runConfig.baseUrl, apiKey: runConfig.apiKey ?? '', model: req.model },
        req,
        signal,
      );
    }
    case 'agent': {
      if (!runConfig.agent) {
        throw new AiError('bad-request', 'DB agent connection is not configured');
      }
      return streamAgentProxy(runConfig.agent, req, signal);
    }
    default:
      throw new AiError('bad-request', `Unknown AI provider: ${String(runConfig.provider)}`);
  }
}
