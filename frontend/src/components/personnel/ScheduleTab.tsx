import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus, X, ArrowLeftRight } from 'lucide-react';
import {
  useWeeklySchedule,
  useShiftTemplates,
  useAssignShift,
  useRemoveAssignment,
  useSwapRequests,
  useApproveSwap,
  useRejectSwap,
} from '../../features/personnel/personnelApi';

const ScheduleTab = () => {
  const { t } = useTranslation('personnel');

  const [weekOffset, setWeekOffset] = useState(0);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ userId: '', shiftTemplateId: '', date: '' });

  const weekStart = useMemo(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) + weekOffset * 7;
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().split('T')[0];
  }, [weekOffset]);

  const { data: schedule } = useWeeklySchedule(weekStart);
  const { data: templates } = useShiftTemplates();
  const { data: swapRequests } = useSwapRequests();
  const assignShift = useAssignShift();
  const removeAssignment = useRemoveAssignment();
  const approveSwap = useApproveSwap();
  const rejectSwap = useRejectSwap();

  const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

  const weekDays = useMemo(() => {
    const start = new Date(weekStart);
    return dayKeys.map((_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const getAssignmentsForUserDay = (userId: string, day: Date) => {
    if (!schedule?.assignments) return [];
    const dayStr = day.toISOString().split('T')[0];
    return schedule.assignments.filter(
      (a) => a.userId === userId && a.date.split('T')[0] === dayStr
    );
  };

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault();
    assignShift.mutate(assignForm, {
      onSuccess: () => {
        setIsAssignModalOpen(false);
        setAssignForm({ userId: '', shiftTemplateId: '', date: '' });
      },
    });
  };

  const pendingSwaps = swapRequests?.filter((r) => r.status === 'PENDING') || [];

  return (
    <div className="space-y-6">
      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="px-4 py-2 text-sm font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
          >
            {t('schedule.thisWeek')}
          </button>
          <button
            onClick={() => setWeekOffset((o) => o + 1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <span className="text-sm text-gray-500">
            {weekDays[0].toLocaleDateString()} - {weekDays[6].toLocaleDateString()}
          </span>
        </div>

        <button
          onClick={() => setIsAssignModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('schedule.assignShift')}
        </button>
      </div>

      {/* Schedule Grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">
                {t('common.employee')}
              </th>
              {weekDays.map((day, i) => (
                <th key={i} className="px-2 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  <div>{t(`days.${dayKeys[i]}`)}</div>
                  <div className="text-gray-400 font-normal">{day.getDate()}/{day.getMonth() + 1}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {schedule?.staff?.map((staffMember) => (
              <tr key={staffMember.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  <div>{staffMember.firstName} {staffMember.lastName}</div>
                  <div className="text-xs text-gray-400">{staffMember.role}</div>
                </td>
                {weekDays.map((day, i) => {
                  const assignments = getAssignmentsForUserDay(staffMember.id, day);
                  return (
                    <td key={i} className="px-2 py-3 text-center">
                      {assignments.length > 0 ? (
                        assignments.map((a) => (
                          <div
                            key={a.id}
                            className="group relative inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-white"
                            style={{ backgroundColor: a.shiftTemplate?.color || '#3B82F6' }}
                          >
                            <span>{a.shiftTemplate?.startTime}-{a.shiftTemplate?.endTime}</span>
                            <button
                              onClick={() => removeAssignment.mutate(a.id)}
                              className="hidden group-hover:block ml-1"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {(!schedule?.staff || schedule.staff.length === 0) && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {t('schedule.noAssignments')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Swap Requests */}
      {pendingSwaps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-purple-600" />
            {t('schedule.swapRequests')} ({pendingSwaps.length})
          </h3>
          <div className="space-y-3">
            {pendingSwaps.map((req) => (
              <div key={req.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="text-sm">
                  <span className="font-medium">{req.requester?.firstName} {req.requester?.lastName}</span>
                  <span className="mx-2 text-gray-400">↔</span>
                  <span className="font-medium">{req.target?.firstName} {req.target?.lastName}</span>
                  {req.reason && <span className="ml-2 text-gray-500">— {req.reason}</span>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => approveSwap.mutate(req.id)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    {t('swap.approve')}
                  </button>
                  <button
                    onClick={() => rejectSwap.mutate(req.id)}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    {t('swap.reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">{t('schedule.assignShift')}</h3>
            <form onSubmit={handleAssign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('schedule.selectEmployee')}</label>
                <select
                  required
                  value={assignForm.userId}
                  onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{t('schedule.selectEmployee')}</option>
                  {schedule?.staff?.map((s) => (
                    <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('schedule.selectShift')}</label>
                <select
                  required
                  value={assignForm.shiftTemplateId}
                  onChange={(e) => setAssignForm({ ...assignForm, shiftTemplateId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{t('schedule.selectShift')}</option>
                  {templates?.filter((tmpl) => tmpl.isActive).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.startTime}-{template.endTime})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('schedule.selectDate')}</label>
                <input
                  type="date"
                  required
                  value={assignForm.date}
                  onChange={(e) => setAssignForm({ ...assignForm, date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={assignShift.isPending}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {t('schedule.assign')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleTab;
