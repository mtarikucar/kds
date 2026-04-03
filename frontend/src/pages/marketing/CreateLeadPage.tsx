import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import marketingApi from '../../features/marketing/api/marketingApi';
import {
  BusinessType,
  LeadSource,
  BUSINESS_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
} from '../../features/marketing/types';

export default function CreateLeadPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [form, setForm] = useState({
    businessName: '',
    contactPerson: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    city: '',
    region: '',
    businessType: 'RESTAURANT',
    tableCount: '',
    branchCount: '',
    currentSystem: '',
    source: 'PHONE',
    notes: '',
    nextFollowUp: '',
    priority: 'MEDIUM',
  });

  const [error, setError] = useState('');

  // Load existing lead data for edit mode
  const { data: existingLead } = useQuery({
    queryKey: ['marketing', 'lead', id],
    queryFn: () => marketingApi.get(`/leads/${id}`).then((r) => r.data),
    enabled: isEdit,
  });

  // Populate form when lead data loads
  useEffect(() => {
    if (existingLead) {
      setForm({
        businessName: existingLead.businessName || '',
        contactPerson: existingLead.contactPerson || '',
        phone: existingLead.phone || '',
        whatsapp: existingLead.whatsapp || '',
        email: existingLead.email || '',
        address: existingLead.address || '',
        city: existingLead.city || '',
        region: existingLead.region || '',
        businessType: existingLead.businessType || 'RESTAURANT',
        tableCount: existingLead.tableCount?.toString() || '',
        branchCount: existingLead.branchCount?.toString() || '',
        currentSystem: existingLead.currentSystem || '',
        source: existingLead.source || 'PHONE',
        notes: existingLead.notes || '',
        nextFollowUp: existingLead.nextFollowUp ? existingLead.nextFollowUp.split('T')[0] : '',
        priority: existingLead.priority || 'MEDIUM',
      });
    }
  }, [existingLead]);

  const mutation = useMutation({
    mutationFn: (data: any) =>
      isEdit
        ? marketingApi.patch(`/leads/${id}`, data)
        : marketingApi.post('/leads', data),
    onSuccess: (res) => {
      const leadId = isEdit ? id : res.data.id;
      navigate(`/marketing/leads/${leadId}`);
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || 'Failed to save lead');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {
      businessName: form.businessName,
      contactPerson: form.contactPerson,
      businessType: form.businessType,
      source: form.source,
      priority: form.priority,
    };

    if (form.phone) data.phone = form.phone;
    if (form.whatsapp) data.whatsapp = form.whatsapp;
    if (form.email) data.email = form.email;
    if (form.address) data.address = form.address;
    if (form.city) data.city = form.city;
    if (form.region) data.region = form.region;
    if (form.tableCount) data.tableCount = parseInt(form.tableCount);
    if (form.branchCount) data.branchCount = parseInt(form.branchCount);
    if (form.currentSystem) data.currentSystem = form.currentSystem;
    if (form.notes) data.notes = form.notes;
    if (form.nextFollowUp) data.nextFollowUp = form.nextFollowUp;

    mutation.mutate(data);
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {isEdit ? 'Edit Lead' : 'New Lead'}
      </h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* Business Info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Business Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Business Name *</label>
              <input
                type="text"
                required
                value={form.businessName}
                onChange={(e) => updateField('businessName', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Business Type *</label>
              <select
                value={form.businessType}
                onChange={(e) => updateField('businessType', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {Object.values(BusinessType).map((t) => (
                  <option key={t} value={t}>{BUSINESS_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Table Count</label>
              <input
                type="number"
                min="0"
                value={form.tableCount}
                onChange={(e) => updateField('tableCount', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Branch Count</label>
              <input
                type="number"
                min="0"
                value={form.branchCount}
                onChange={(e) => updateField('branchCount', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">Current System</label>
              <input
                type="text"
                value={form.currentSystem}
                onChange={(e) => updateField('currentSystem', e.target.value)}
                placeholder="e.g., Paper-based, Competitor POS"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Contact Info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Contact Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Contact Person *</label>
              <input
                type="text"
                required
                value={form.contactPerson}
                onChange={(e) => updateField('contactPerson', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">WhatsApp</label>
              <input
                type="tel"
                value={form.whatsapp}
                onChange={(e) => updateField('whatsapp', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Location */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Location</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Region</label>
              <input
                type="text"
                value={form.region}
                onChange={(e) => updateField('region', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Lead Info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Lead Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Source *</label>
              <select
                value={form.source}
                onChange={(e) => updateField('source', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {Object.values(LeadSource).map((s) => (
                  <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => updateField('priority', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Next Follow-up</label>
              <input
                type="date"
                value={form.nextFollowUp}
                onChange={(e) => updateField('nextFollowUp', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm text-gray-600 mb-1">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : isEdit ? 'Update Lead' : 'Create Lead'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-6 py-2.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
