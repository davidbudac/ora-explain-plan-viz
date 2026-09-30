import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ErrorFallback } from './ErrorFallback';

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /**
   * 'page' (default) centers the fallback card in the viewport — use at the app root.
   * 'panel' renders a compact card that fits inside a layout region.
   */
  variant?: 'page' | 'panel';
  /** Called with the error and React's component stack (e.g. to log it). */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** Called when the user presses "Try again", after the boundary has reset. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

/**
 * Catches render/lifecycle errors in its subtree and shows a recoverable
 * fallback instead of a blank screen. Mounted at the app root in `main.tsx`;
 * can also wrap individual panels with `variant="panel"`.
 *
 * Note: it does not catch errors thrown in event handlers or async code.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? '' });
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  private handleReset = (): void => {
    this.setState({ error: null, componentStack: '' });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error) {
      return (
        <ErrorFallback
          error={error}
          componentStack={componentStack}
          variant={this.props.variant ?? 'page'}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}
