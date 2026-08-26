/**
 * Provider dispatch for AI plan analysis streaming.
 *
 * Routes an AiRequest to the configured provider implementation and
 * validates that the config carries what that provider needs.
 */

import type { AgentConfig } from '../agent/client';
import type { AiChatMessage, AiProviderId, AiRequest, AiStreamEvent } from './types';
import { AiError } from './types';
import { streamAnthropic } from './providers/anthropic';
import { streamOpenAiCompat } from './providers/openaiCompat';
import { streamAgentProxy } from './providers/agent';
import { streamHosted } from './providers/hosted';

/** Default base URL for the hosted oraplanviz cloud backend. */
export const DEFAULT_HOSTED_BASE_URL = 'https://api.oraplanviz.com';

/** Resolved, ready-to-run configuration for one analysis request. */
export interface AiRunConfig {
  provider: AiProviderId;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  agent?: AgentConfig;
  accountToken?: string;
  hostedBaseUrl?: string;
}

export function streamAnalysis(
  runConfig: AiRunConfig,
  req: AiRequest,
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  switch (runConfig.provider) {
    case 'hosted': {
      if (!runConfig.accountToken) {
        throw new AiError('bad-request', 'Hosted account token is not configured');
      }
      return streamHosted(
        {
          baseUrl: runConfig.hostedBaseUrl || DEFAULT_HOSTED_BASE_URL,
          accountToken: runConfig.accountToken,
        },
        req,
        signal,
      );
    }
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

/** Options for one multi-turn chat completion (the last message must be the new user turn). */
export interface AiChatOptions {
  system: string;
  messages: AiChatMessage[];
  model: string;
  maxTokens: number;
}

/**
 * Flattens a multi-turn conversation into a single prompt for providers that
 * only expose a single-turn endpoint (local agent proxy, hosted /v1/analyze).
 * The last user turn becomes the request; prior turns are quoted with clear
 * delimiters so the model can follow the thread.
 */
export function flattenChatToPrompt(messages: AiChatMessage[]): string {
  const parts: string[] = [
    'This is a multi-turn conversation flattened into one message. Prior turns are',
    'delimited below; respond only to the final "User:" turn, using the earlier',
    'turns as context.',
    '',
  ];
  for (const message of messages) {
    parts.push(message.role === 'user' ? 'User:' : 'Assistant:');
    parts.push(message.content);
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Streams one reply of a multi-turn conversation. Anthropic and
 * OpenAI-compatible providers get the real messages array; the agent and
 * hosted providers (single-turn /analyze endpoints only, so far) get the
 * conversation flattened into the prompt.
 */
export function streamChat(
  runConfig: AiRunConfig,
  opts: AiChatOptions,
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const base: AiRequest = {
    system: opts.system,
    user: lastUser,
    model: opts.model,
    maxTokens: opts.maxTokens,
  };

  switch (runConfig.provider) {
    case 'anthropic': {
      if (!runConfig.apiKey) {
        throw new AiError('bad-request', 'Anthropic API key is not configured');
      }
      return streamAnthropic({ apiKey: runConfig.apiKey }, { ...base, messages: opts.messages }, signal);
    }
    case 'openai-compat': {
      if (!runConfig.baseUrl) {
        throw new AiError('bad-request', 'OpenAI-compatible base URL is not configured');
      }
      return streamOpenAiCompat(
        { baseUrl: runConfig.baseUrl, apiKey: runConfig.apiKey ?? '', model: opts.model },
        { ...base, messages: opts.messages },
        signal,
      );
    }
    case 'agent':
    case 'hosted':
      return streamAnalysis(runConfig, { ...base, user: flattenChatToPrompt(opts.messages) }, signal);
    default:
      throw new AiError('bad-request', `Unknown AI provider: ${String(runConfig.provider)}`);
  }
}
