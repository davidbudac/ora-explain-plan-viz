/**
 * Provider dispatch for AI plan analysis streaming.
 *
 * Routes an AiRequest to the configured provider implementation and
 * validates that the config carries what that provider needs.
 */

import type { AgentConfig } from '../agent/client';
import type { AiChatMessage, AiProviderId, AiRequest, AiStreamEvent } from './types';
import { AiError } from './types';
import { streamOpenAiCompat } from './providers/openaiCompat';
import { streamAgentProxy } from './providers/agent';

/**
 * The Anthropic provider is loaded on first use, so the Anthropic SDK stays
 * out of the initial bundle (the other providers are plain `fetch`).
 */
async function* streamAnthropic(
  config: { apiKey: string },
  req: AiRequest & { messages?: AiChatMessage[] },
  signal: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const provider = await import('./providers/anthropic');
  yield* provider.streamAnthropic(config, req, signal);
}

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

/** Options for one multi-turn chat completion (the last message must be the new user turn). */
export interface AiChatOptions {
  system: string;
  messages: AiChatMessage[];
  model: string;
  maxTokens: number;
}

/**
 * Flattens a multi-turn conversation into a single prompt for providers that
 * only expose a single-turn endpoint (the local agent proxy's /api/ai/analyze).
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
 * OpenAI-compatible providers get the real messages array; the agent
 * provider (a single-turn /analyze endpoint, so far) gets the
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
      return streamAnalysis(runConfig, { ...base, user: flattenChatToPrompt(opts.messages) }, signal);
    default:
      throw new AiError('bad-request', `Unknown AI provider: ${String(runConfig.provider)}`);
  }
}
