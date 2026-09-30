/**
 * User-facing feedback for header / palette actions whose outcome is otherwise
 * invisible (share-link copy, PNG export). Pure: callers pass the notifier
 * (normally the toast API), so the wording and branching are unit-testable.
 */

export type FeedbackTone = 'success' | 'error' | 'info' | 'warning';

export interface FeedbackMessage {
  tone: FeedbackTone;
  title?: string;
  message: string;
}

/** Structural mirror of the plan context's `ShareNotice`. */
export type ShareOutcome =
  | { kind: 'copied'; url: string }
  | { kind: 'warning'; url: string; warning?: string }
  | { kind: 'manual'; url: string; warning?: string }
  | { kind: 'error'; message: string };

/**
 * Toast for a share outcome. `error` returns null: the share dialog already
 * explains that failure in place, so a second message would only repeat it.
 */
export function shareFeedback(outcome: ShareOutcome): FeedbackMessage | null {
  switch (outcome.kind) {
    case 'copied':
      return { tone: 'success', message: 'Link copied to clipboard' };
    case 'warning':
      return {
        tone: 'warning',
        title: 'Link copied to clipboard',
        message: outcome.warning ?? 'The link is long — check it pasted in full before sharing.',
      };
    case 'manual':
      return {
        tone: 'warning',
        title: 'Could not copy the link automatically',
        message: 'Copy it from the share dialog instead.',
      };
    case 'error':
      return null;
  }
}

export const PNG_EXPORT_UNAVAILABLE_HINT = 'Plan as PNG is only available in the single-plan Tree view';

/**
 * Runs the registered PNG export and reports the outcome. Resolves true on
 * success. Never throws: a failure becomes an error message.
 */
export async function runPngExport(
  exportFn: (() => Promise<void>) | null | undefined,
  notify: (feedback: FeedbackMessage) => void,
): Promise<boolean> {
  if (!exportFn) {
    notify({ tone: 'info', message: `${PNG_EXPORT_UNAVAILABLE_HINT}.` });
    return false;
  }
  try {
    await exportFn();
    notify({ tone: 'success', message: 'PNG downloaded' });
    return true;
  } catch (error) {
    notify({
      tone: 'error',
      title: 'PNG export failed',
      message: error instanceof Error && error.message ? error.message : 'The plan image could not be generated.',
    });
    return false;
  }
}
