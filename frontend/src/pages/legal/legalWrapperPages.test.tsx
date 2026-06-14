import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// These three pages are intentionally thin: each just renders LegalDocumentPage
// with a fixed `kind`. The contract worth pinning is exactly that prop — a
// copy-paste slip (e.g. KvkkPage passing 'REFUND_POLICY') would serve the wrong
// legal document to users. We mock the shared page to capture the kind.
const lastProps: { kind?: string } = {};
vi.mock('./LegalDocumentPage', () => ({
  default: (props: { kind: string }) => {
    lastProps.kind = props.kind;
    return <div data-testid="legal-doc">{props.kind}</div>;
  },
}));

import KvkkPage from './KvkkPage';
import DistanceSalesPage from './DistanceSalesPage';
import RefundPolicyPage from './RefundPolicyPage';

describe('legal document wrapper pages', () => {
  it.each([
    [KvkkPage, 'KVKK'],
    [DistanceSalesPage, 'DISTANCE_SALES'],
    [RefundPolicyPage, 'REFUND_POLICY'],
  ])('passes the correct kind to LegalDocumentPage', (Page, kind) => {
    const { getByTestId } = render(<Page />);
    expect(getByTestId('legal-doc').textContent).toBe(kind);
    expect(lastProps.kind).toBe(kind);
  });
});
