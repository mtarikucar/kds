import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
  PencilSquareIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import marketingApi from '../../features/marketing/api/marketingApi';
import { LeadStatusBadge, ActivityTimeline } from '../../features/marketing/components';
import {
  LeadStatus,
  LEAD_STATUS_LABELS,
  BUSINESS_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
  ActivityType,
} from '../../features/marketing/types';
import type { Lead, LeadActivity } from '../../features/marketing/types';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [activityType, setActivityType] = useState<string>('NOTE');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityDesc, setActivityDesc] = useState('');

  const { data: lead, isLoading } = useQuery({
    queryKey: ['marketing', 'lead', id],
    queryFn: () => marketingApi.get<Lead>(`/leads/${id}`).then((r) => r.data),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      marketingApi.patch(`/leads/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'lead', id] });
    },
  });

  const activityMutation = useMutation({
    mutationFn: (data: { type: string; title: string; description?: string }) =>
      marketingApi.post(`/leads/${id}/activities`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing', 'lead', id] });
      setShowActivityForm(false);
      setActivityTitle('');
      setActivityDesc('');
    },
  });

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500">Loading...</div>;
  }

  if (!lead) {
    return <div className="text-center py-12 text-gray-500">Lead not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/marketing/leads" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{lead.businessName}</h1>
            <p className="text-sm text-gray-500">{lead.contactPerson}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LeadStatusBadge status={lead.status} />
          <Link
            to={`/marketing/leads/${id}/edit`}
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            <PencilSquareIcon className="w-4 h-4" />
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Info */}
        <div className="lg:col-span-1 space-y-4">
          {/* Contact Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Contact Info</h3>
            <div className="space-y-2 text-sm">
              {lead.phone && (
                <div className="flex items-center gap-2">
                  <PhoneIcon className="w-4 h-4 text-gray-400" />
                  <a href={`tel:${lead.phone}`} className="text-indigo-600 hover:underline">{lead.phone}</a>
                </div>
              )}
              {lead.whatsapp && (
                <div className="flex items-center gap-2">
                  <PhoneIcon className="w-4 h-4 text-green-500" />
                  <a href={`https://wa.me/${lead.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline">
                    WhatsApp
                  </a>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-2">
                  <EnvelopeIcon className="w-4 h-4 text-gray-400" />
                  <a href={`mailto:${lead.email}`} className="text-indigo-600 hover:underline">{lead.email}</a>
                </div>
              )}
              {(lead.city || lead.address) && (
                <div className="flex items-center gap-2">
                  <MapPinIcon className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-600">{lead.city}{lead.address ? `, ${lead.address}` : ''}</span>
                </div>
              )}
            </div>
          </div>

          {/* Business Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Business Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Type</dt>
                <dd className="text-gray-900">{BUSINESS_TYPE_LABELS[lead.businessType as keyof typeof BUSINESS_TYPE_LABELS] || lead.businessType}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Source</dt>
                <dd className="text-gray-900">{LEAD_SOURCE_LABELS[lead.source as keyof typeof LEAD_SOURCE_LABELS] || lead.source}</dd>
              </div>
              {lead.tableCount != null && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Tables</dt>
                  <dd className="text-gray-900">{lead.tableCount}</dd>
                </div>
              )}
              {lead.branchCount != null && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Branches</dt>
                  <dd className="text-gray-900">{lead.branchCount}</dd>
                </div>
              )}
              {lead.currentSystem && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Current System</dt>
                  <dd className="text-gray-900">{lead.currentSystem}</dd>
                </div>
              )}
              {lead.assignedTo && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Assigned To</dt>
                  <dd className="text-gray-900">{lead.assignedTo.firstName} {lead.assignedTo.lastName}</dd>
                </div>
              )}
              {lead.nextFollowUp && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Next Follow-up</dt>
                  <dd className="text-gray-900">{new Date(lead.nextFollowUp).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Status Change */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Change Status</h3>
            <div className="flex flex-wrap gap-2">
              {Object.values(LeadStatus).map((s) => (
                <button
                  key={s}
                  onClick={() => statusMutation.mutate(s)}
                  disabled={lead.status === s || statusMutation.isPending}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    lead.status === s
                      ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  {LEAD_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          {lead.notes && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Notes</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}
        </div>

        {/* Right: Activity Timeline */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Activity Timeline</h3>
              <button
                onClick={() => setShowActivityForm(!showActivityForm)}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                + Add Activity
              </button>
            </div>

            {/* Quick Activity Form */}
            {showActivityForm && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
                <div className="flex gap-3">
                  <select
                    value={activityType}
                    onChange={(e) => setActivityType(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  >
                    {Object.values(ActivityType).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Activity title"
                    value={activityTitle}
                    onChange={(e) => setActivityTitle(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <textarea
                  placeholder="Description (optional)"
                  value={activityDesc}
                  onChange={(e) => setActivityDesc(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      activityMutation.mutate({
                        type: activityType,
                        title: activityTitle,
                        description: activityDesc || undefined,
                      })
                    }
                    disabled={!activityTitle || activityMutation.isPending}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {activityMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setShowActivityForm(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <ActivityTimeline activities={(lead as any).activities || []} />
          </div>
        </div>
      </div>
    </div>
  );
}
