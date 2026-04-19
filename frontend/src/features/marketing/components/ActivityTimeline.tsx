import {
  PhoneIcon,
  MapPinIcon,
  EnvelopeIcon,
  ChatBubbleLeftIcon,
  ArrowPathIcon,
  PresentationChartLineIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import type { LeadActivity } from '../types';

const activityIcons: Record<string, React.ElementType> = {
  CALL: PhoneIcon,
  VISIT: MapPinIcon,
  EMAIL: EnvelopeIcon,
  WHATSAPP: ChatBubbleLeftIcon,
  NOTE: ChatBubbleLeftIcon,
  STATUS_CHANGE: ArrowPathIcon,
  DEMO: PresentationChartLineIcon,
  MEETING: UserGroupIcon,
};

const outcomeColors: Record<string, string> = {
  POSITIVE: 'text-green-600',
  NEGATIVE: 'text-red-600',
  NEUTRAL: 'text-gray-600',
  NO_ANSWER: 'text-orange-600',
};

interface ActivityTimelineProps {
  activities: LeadActivity[];
}

export default function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (!activities.length) {
    return (
      <p className="text-sm text-gray-500 text-center py-8">
        No activities yet
      </p>
    );
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {activities.map((activity, idx) => {
          const Icon = activityIcons[activity.type] || ChatBubbleLeftIcon;
          const isLast = idx === activities.length - 1;

          return (
            <li key={activity.id}>
              <div className="relative pb-8">
                {!isLast && (
                  <span className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200" />
                )}
                <div className="relative flex space-x-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                    <Icon className="h-4 w-4 text-gray-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">
                        {activity.title}
                      </p>
                      <time className="text-xs text-gray-400">
                        {new Date(activity.createdAt).toLocaleDateString()}
                      </time>
                    </div>
                    {activity.description && (
                      <p className="mt-1 text-sm text-gray-600">
                        {activity.description}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                      <span>{activity.createdBy.firstName} {activity.createdBy.lastName}</span>
                      {activity.outcome && (
                        <span className={outcomeColors[activity.outcome] || 'text-gray-500'}>
                          {activity.outcome}
                        </span>
                      )}
                      {activity.duration && (
                        <span>{activity.duration} min</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
