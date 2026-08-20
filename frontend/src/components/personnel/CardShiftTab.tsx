import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CreditCard, ExternalLink } from 'lucide-react';
import {
  useAssignCard,
  useCardAssignments,
  useRevokeCard,
} from '../../features/personnel/personnelApi';

/**
 * Staff-card enrolment.
 *
 * The UID never round-trips: it is typed by the reader into a field that is
 * cleared on submit, sent once, and stored as a peppered HMAC. The table can
 * therefore only ever show the last four digits — enough to match a plastic
 * card to a person, useless for enrolling a clone.
 */
const CardShiftTab = () => {
  const { t } = useTranslation(['personnel', 'common']);
  const { data: assignments, isLoading } = useCardAssignments();
  const assign = useAssignCard();
  const revoke = useRevokeCard();
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [uid, setUid] = useState('');

  const submit = async (userId: string) => {
    if (!uid.trim()) return;
    const cardUid = uid;
    // Clear FIRST: an await that rejects must not leave the UID on screen.
    setUid('');
    setEnrolling(null);
    await assign.mutateAsync({ userId, cardUid });
  };

  const onRevoke = (row: { userId: string; firstName: string; lastName: string }) => {
    const name = `${row.firstName} ${row.lastName}`;
    if (!window.confirm(t('personnel:cardShift.revokeConfirm', { name }))) return;
    revoke.mutateAsync(row.userId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <CreditCard className="h-4 w-4" />
          {t('personnel:cardShift.title')}
        </h2>
        {/* The kiosk tablet is opened from here in practice; the sidebar entry
            exists too, but an admin enrolling cards is already on this screen. */}
        <Link
          to="/card-shift"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          {t('personnel:cardShift.openStation')}
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">
                {t('personnel:attendance.staff')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">
                {t('personnel:cardShift.cardLast4')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">
                {t('personnel:cardShift.assignedAt')}
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  {t('personnel:common.loading')}
                </td>
              </tr>
            ) : (
              (assignments ?? []).map((row) => (
                <tr key={row.userId}>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {row.firstName} {row.lastName}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {row.last4 ? (
                      <span className="font-mono">{`•••• ${row.last4}`}</span>
                    ) : (
                      <span className="text-slate-400">
                        {t('personnel:cardShift.noCard')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {row.assignedAt
                      ? new Date(row.assignedAt).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {enrolling === row.userId ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          submit(row.userId);
                        }}
                      >
                        <input
                          autoFocus
                          aria-label={t('personnel:cardShift.tapPrompt')}
                          placeholder={t('personnel:cardShift.tapPrompt')}
                          value={uid}
                          onChange={(e) => setUid(e.target.value)}
                          className="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                        />
                      </form>
                    ) : (
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          className="text-primary-600 hover:underline"
                          onClick={() => {
                            setUid('');
                            setEnrolling(row.userId);
                          }}
                        >
                          {t('personnel:cardShift.assign')}
                        </button>
                        {row.last4 && (
                          <button
                            type="button"
                            className="text-red-600 hover:underline"
                            onClick={() => onRevoke(row)}
                          >
                            {t('personnel:cardShift.revoke')}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CardShiftTab;
