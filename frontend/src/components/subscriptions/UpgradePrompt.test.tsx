import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UpgradePrompt from './UpgradePrompt';

// Echo interpolated opts so we can assert the computed required-plan and
// limit numbers, not translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (key === 'subscriptions:subscriptions.featureRequiresPlan') {
        return `requiresPlan:${opts?.plan}`;
      }
      if (key === 'subscriptions:subscriptions.upgradeToAccess') {
        return `upgradeTo:${opts?.plan}`;
      }
      if (key === 'subscriptions:subscriptions.limitReached') {
        return `limitReached:${opts?.current}/${opts?.limit}`;
      }
      if (key === 'subscriptions:subscriptions.limitReachedDescription') {
        return `limitReachedDesc:${opts?.resource}:${opts?.current}/${opts?.limit}`;
      }
      if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue;
      return key;
    },
  }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

describe('UpgradePrompt', () => {
  beforeEach(() => navigateMock.mockClear());

  it('maps a PRO-tier feature to its required plan in compact mode', () => {
    render(<UpgradePrompt feature="advancedReports" compact />);
    expect(screen.getByText('requiresPlan:PRO')).toBeInTheDocument();
  });

  it('maps a BASIC-tier feature (posAccess) to BASIC as the required plan', () => {
    render(<UpgradePrompt feature="posAccess" compact />);
    expect(screen.getByText('requiresPlan:BASIC')).toBeInTheDocument();
  });

  it('maps a BUSINESS-tier feature (apiAccess) to BUSINESS in the full block', () => {
    render(<UpgradePrompt feature="apiAccess" />);
    // Full block renders "<featureNotAvailable><br/><upgradeTo:BUSINESS>"
    // inside one <p>, so the text is split across nodes — match on the
    // combined textContent.
    // The <p> holds the feature text + a <br/> + the upgradeTo line. Match
    // only the innermost <p> (no element children besides <br/>) whose text
    // contains the BUSINESS upgrade line.
    expect(
      screen.getByText(
        (content, el) =>
          el?.tagName === 'P' &&
          (el.textContent ?? '').includes('upgradeTo:BUSINESS'),
      ),
    ).toBeInTheDocument();
  });

  it('renders the limit-reached message (current/limit) when a limit is supplied', () => {
    render(
      <UpgradePrompt limitType="maxUsers" currentCount={5} limit={5} compact />,
    );
    expect(screen.getByText('limitReached:5/5')).toBeInTheDocument();
  });

  it('renders the full-block limit-reached description with resource + numbers', () => {
    render(<UpgradePrompt limitType="maxProducts" currentCount={200} limit={200} />);
    // getDisplayName resolves the limit label to its i18n defaultValue
    // ("maxProducts"); the description interpolates current/limit.
    expect(
      screen.getByText('limitReachedDesc:maxProducts:200/200'),
    ).toBeInTheDocument();
  });

  it('navigates to the change-plan page from the compact upgrade link', () => {
    render(<UpgradePrompt feature="advancedReports" compact />);
    fireEvent.click(
      screen.getByRole('button', { name: 'subscriptions:subscriptions.upgrade' }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/subscription/change-plan');
  });

  it('navigates to the change-plan page from the full "view plans" CTA', () => {
    render(<UpgradePrompt feature="advancedReports" />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions:subscriptions.viewPlans',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/subscription/change-plan');
  });
});
