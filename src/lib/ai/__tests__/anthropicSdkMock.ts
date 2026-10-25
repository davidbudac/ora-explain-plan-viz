import { vi } from 'vitest';

/**
 * Shared stand-in for `@anthropic-ai/sdk`: a minimal error hierarchy plus capturable
 * `beta.messages.stream()` and constructor mocks. Use from a test file with
 *
 *   vi.mock('@anthropic-ai/sdk', async () => (await import('./anthropicSdkMock')).anthropicSdkModule());
 *   import { streamMock, constructorMock } from './anthropicSdkMock';
 *
 * (`vi.mock` is hoisted above imports, so the factory must load this module itself.)
 */
export const streamMock = vi.fn();
export const constructorMock = vi.fn();

export function anthropicSdkModule() {
  class APIError extends Error {
    status: number | undefined;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  class APIUserAbortError extends APIError {}
  class APIConnectionError extends APIError {}
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}

  class Anthropic {
    beta = { messages: { stream: streamMock } };
    constructor(opts: unknown) {
      constructorMock(opts);
    }
    static APIError = APIError;
    static APIUserAbortError = APIUserAbortError;
    static APIConnectionError = APIConnectionError;
    static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError;
    static BadRequestError = BadRequestError;
  }
  return { default: Anthropic };
}
