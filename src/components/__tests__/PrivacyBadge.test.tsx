/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { afterEach, describe, expect, it } from 'vitest';
import { PrivacyBadge } from '../PrivacyBadge';
import { cleanup, render } from '../ui/__tests__/testUtils';

afterEach(cleanup);

describe('PrivacyBadge', () => {
  it('says plans never leave the browser', () => {
    const { container } = render(<PrivacyBadge />);
    const badge = container.querySelector('[data-testid="privacy-badge"]');
    expect(badge?.textContent).toContain('your plans never leave this browser');
    expect(badge?.textContent).toContain('Nothing is uploaded');
  });
});
