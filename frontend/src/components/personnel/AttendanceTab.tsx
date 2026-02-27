import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  AlertTriangle,
  CheckCircle,
  Users,
  Loader2,
} from 'lucide-react';
import {
  useMyAttendanceStatus,
  useAttendanceToday,
  useAttendanceList,
  useAttendanceSummary,
  useClockIn,
  useClockOut,
  useStartBreak,
  useEndBreak,
} from '../../features/personnel/personnelApi';
import { useAuthStore } from '../../store/authStore';
import { UserRole, Attendance } from '../../types';

function isAttendanceRecord(status: Attendance | { status: string; date: string }): status is Attendance {
  return 'clockIn' in status;
}

const AttendanceTab = () => {
  const { t } = useTranslation('personnel');
  const user = useAuthStore((state) => state.user);
  const isManager = user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER;

  const [historyFilter, setHistoryFilter] = useState<{ startDate?: string; endDate?: string }>({});
  const [activeSection, setActiveSection] = useState<'today' | 'history' | 'summary'>('today');

  const { data: myStatus } = useMyAttendanceStatus();
  const { data: todayAttendance, isLoading: todayLoading } = useAttendanceToday();
  const { data: history, isLoading: historyLoading } = useAttendanceList(
    historyFilter,
    { enabled: activeSection === 'history' },
  );
  const { data: summary, isLoading: summaryLoading } = useAttendanceSummary({});

  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const startBreak = useStartBreak();
  const endBreak = useEndBreak();

  const myStatusValue = myStatus?.status || 'NOT_CLOCKED_IN';
  const myAttendance = myStatus && isAttendanceRecord(myStatus) ? myStatus : null;

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatMinutes = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const historyData = history?.data || [];

  return (
    <div className="space-y-6">
      {/* My Status Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" />
          {t('attendance.myStatus')}
        </h3>

        <div className="flex items-center gap-4 mb-4">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
            myStatusValue === 'CLOCKED_IN' ? 'bg-green-100 text-green-700' :
            myStatusValue === 'ON_BREAK' ? 'bg-yellow-100 text-yellow-700' :
            myStatusValue === 'CLOCKED_OUT' ? 'bg-gray-100 text-gray-700' :
            'bg-red-100 text-red-700'
          }`}>
            {myStatusValue === 'CLOCKED_IN' && <CheckCircle className="h-4 w-4" />}
            {myStatusValue === 'ON_BREAK' && <Coffee className="h-4 w-4" />}
            {t(`attendance.status.${myStatusValue}`)}
          </div>

          {myAttendance?.clockIn && (
            <span className="text-sm text-gray-500">
              {t('attendance.clockInTime')}: {formatTime(myAttendance.clockIn)}
            </span>
          )}

          {myAttendance?.isLate && (
            <span className="inline-flex items-center gap-1 text-sm text-red-600">
              <AlertTriangle className="h-4 w-4" />
              {t('attendance.lateMinutes', { minutes: myAttendance.lateMinutes })}
            </span>
          )}
        </div>

        <div className="flex gap-3">
          {myStatusValue === 'NOT_CLOCKED_IN' && (
            <button
              onClick={() => clockIn.mutate(undefined)}
              disabled={clockIn.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <LogIn className="h-4 w-4" />
              {t('attendance.clockIn')}
            </button>
          )}

          {myStatusValue === 'CLOCKED_IN' && (
            <>
              <button
                onClick={() => startBreak.mutate()}
                disabled={startBreak.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50 transition-colors"
              >
                <Coffee className="h-4 w-4" />
                {t('attendance.startBreak')}
              </button>
              <button
                onClick={() => clockOut.mutate()}
                disabled={clockOut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {t('attendance.clockOut')}
              </button>
            </>
          )}

          {myStatusValue === 'ON_BREAK' && (
            <button
              onClick={() => endBreak.mutate()}
              disabled={endBreak.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Coffee className="h-4 w-4" />
              {t('attendance.endBreak')}
            </button>
          )}
        </div>
      </div>

      {/* Manager sections */}
      {isManager && (
        <>
          {/* Section tabs */}
          <div className="flex gap-2 border-b border-gray-200">
            {(['today', 'history', 'summary'] as const).map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeSection === section
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {section === 'today' ? t('attendance.todayDashboard') :
                 section === 'history' ? t('attendance.history') :
                 t('attendance.summary')}
              </button>
            ))}
          </div>

          {/* Today's Dashboard */}
          {activeSection === 'today' && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  {t('attendance.todayDashboard')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.staff')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('common.status')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.clockInTime')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.clockOutTime')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.late')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {todayLoading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
                          {t('common.loading')}
                        </td>
                      </tr>
                    ) : todayAttendance && todayAttendance.length > 0 ? (
                      todayAttendance.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {a.user?.firstName} {a.user?.lastName}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                              a.status === 'CLOCKED_IN' ? 'bg-green-100 text-green-700' :
                              a.status === 'ON_BREAK' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {t(`attendance.status.${a.status}`)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatTime(a.clockIn)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatTime(a.clockOut)}</td>
                          <td className="px-4 py-3 text-sm">
                            {a.isLate ? (
                              <span className="text-red-600 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {a.lateMinutes}m
                              </span>
                            ) : (
                              <span className="text-green-600">{t('attendance.onTime')}</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          {t('attendance.noRecords')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* History */}
          {activeSection === 'history' && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-4 border-b border-gray-100 flex items-center gap-4">
                <input
                  type="date"
                  value={historyFilter.startDate || ''}
                  onChange={(e) => setHistoryFilter((f) => ({ ...f, startDate: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="date"
                  value={historyFilter.endDate || ''}
                  onChange={(e) => setHistoryFilter((f) => ({ ...f, endDate: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.date')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.staff')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.clockInTime')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.clockOutTime')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.workedHours')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.overtime')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.late')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {historyLoading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                          <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
                          {t('common.loading')}
                        </td>
                      </tr>
                    ) : historyData.length > 0 ? (
                      historyData.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{new Date(a.date).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{a.user?.firstName} {a.user?.lastName}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatTime(a.clockIn)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatTime(a.clockOut)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatMinutes(a.totalWorkedMinutes)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{a.overtimeMinutes > 0 ? formatMinutes(a.overtimeMinutes) : '-'}</td>
                          <td className="px-4 py-3 text-sm">
                            {a.isLate ? (
                              <span className="text-red-600">{a.lateMinutes}m</span>
                            ) : (
                              <span className="text-green-600">{t('attendance.onTime')}</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                          {t('attendance.noRecords')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {history && history.totalPages > 1 && (
                <div className="p-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                  <span>{t('common.total')}: {history.total}</span>
                  <span>{t('common.page')} {history.page} / {history.totalPages}</span>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          {activeSection === 'summary' && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.staff')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.totalDays')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.totalHours')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.totalOvertime')}</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('attendance.lateDays')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {summaryLoading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          <Loader2 className="h-5 w-5 animate-spin inline-block mr-2" />
                          {t('common.loading')}
                        </td>
                      </tr>
                    ) : summary && summary.length > 0 ? (
                      summary.map((s) => (
                        <tr key={s.user.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.user.firstName} {s.user.lastName}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{s.totalDays}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatMinutes(s.totalWorkedMinutes)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatMinutes(s.totalOvertimeMinutes)}</td>
                          <td className="px-4 py-3 text-sm">
                            {s.lateDays > 0 ? (
                              <span className="text-red-600">{s.lateDays}</span>
                            ) : (
                              <span className="text-green-600">0</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          {t('attendance.noRecords')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AttendanceTab;
