import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import marketingApi from '../../features/marketing/api/marketingApi';
import type { MarketingTask } from '../../features/marketing/types';

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const dateFrom = new Date(year, month, 1).toISOString();
  const dateTo = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

  const { data: tasks } = useQuery({
    queryKey: ['marketing', 'tasks', 'calendar', year, month],
    queryFn: () =>
      marketingApi
        .get('/tasks/calendar', { params: { dateFrom, dateTo } })
        .then((r) => r.data),
  });

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay(); // 0=Sun
    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    for (let i = startPad - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }

    // Next month padding
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
    }

    return days;
  }, [year, month]);

  const tasksByDate = useMemo(() => {
    const map: Record<string, MarketingTask[]> = {};
    if (tasks) {
      (tasks as MarketingTask[]).forEach((task) => {
        const key = new Date(task.dueDate).toISOString().split('T')[0];
        if (!map[key]) map[key] = [];
        map[key].push(task);
      });
    }
    return map;
  }, [tasks]);

  const goToMonth = (delta: number) => {
    setCurrentDate(new Date(year, month + delta, 1));
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const monthName = currentDate.toLocaleString('en', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>

      {/* Navigation */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
        <button onClick={() => goToMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-gray-900">{monthName}</h2>
        <button onClick={() => goToMonth(1)} className="p-2 hover:bg-gray-100 rounded-lg">
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-medium text-gray-500">
              {day}
            </div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7">
          {calendarDays.map(({ date, isCurrentMonth }, idx) => {
            const dateKey = date.toISOString().split('T')[0];
            const dayTasks = tasksByDate[dateKey] || [];

            return (
              <div
                key={idx}
                className={`min-h-[80px] p-1 border-b border-r ${
                  !isCurrentMonth ? 'bg-gray-50' : ''
                }`}
              >
                <p
                  className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday(date) ? 'bg-indigo-600 text-white' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                  }`}
                >
                  {date.getDate()}
                </p>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map((task) => (
                    <div
                      key={task.id}
                      className={`text-xs px-1 py-0.5 rounded truncate ${
                        task.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-700 line-through'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}
                      title={task.title}
                    >
                      {task.title}
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <p className="text-xs text-gray-400 px-1">+{dayTasks.length - 3} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
