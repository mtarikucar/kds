import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  Users,
  Clock,
  MapPin,
  User,
  Check,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  usePublicReservationSettings,
  useAvailableSlots,
  useAvailableTables,
  useCreatePublicReservation,
} from '../../features/reservations/publicReservationsApi';
import type { CreateReservationDto, AvailableTable, Reservation } from '../../types';

const TOTAL_STEPS = 5;

interface CustomerInfo {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

const PublicReservationPage: React.FC = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { t } = useTranslation('reservations');

  // Wizard state
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState('');
  const [guestCount, setGuestCount] = useState(2);
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedEndTime, setSelectedEndTime] = useState('');
  const [selectedTable, setSelectedTable] = useState<AvailableTable | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [createdReservation, setCreatedReservation] = useState<Reservation | null>(null);

  // API hooks
  const { data: settings, isLoading: settingsLoading, error: settingsError } = usePublicReservationSettings(
    tenantId || ''
  );
  const { data: availableSlots, isLoading: slotsLoading } = useAvailableSlots(
    tenantId || '',
    selectedDate,
    guestCount
  );
  const { data: availableTables, isLoading: tablesLoading } = useAvailableTables(
    tenantId || '',
    selectedDate,
    selectedTime,
    selectedEndTime,
    guestCount
  );
  const createReservation = useCreatePublicReservation();

  // Compute min date (today) and max date
  const minDate = useMemo(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }, []);

  const maxDate = useMemo(() => {
    if (!settings?.maxAdvanceDays) return '';
    const max = new Date();
    max.setDate(max.getDate() + settings.maxAdvanceDays);
    return max.toISOString().split('T')[0];
  }, [settings?.maxAdvanceDays]);

  // Calculate end time from start time + default duration
  const calculateEndTime = (startTime: string): string => {
    const duration = settings?.defaultDuration || 60;
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + duration;
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  };

  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
    setSelectedEndTime(calculateEndTime(time));
    setSelectedTable(null);
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setSelectedTime('');
    setSelectedEndTime('');
    setSelectedTable(null);
  };

  const handleGuestCountChange = (count: number) => {
    setGuestCount(count);
    setSelectedTime('');
    setSelectedEndTime('');
    setSelectedTable(null);
  };

  const validateCustomerInfo = (): boolean => {
    const errors: Record<string, string> = {};
    if (!customerInfo.name.trim()) {
      errors.name = t('public.validation.nameRequired');
    }
    if (!customerInfo.phone.trim()) {
      errors.phone = t('public.validation.phoneRequired');
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const canGoNext = (): boolean => {
    switch (step) {
      case 1:
        return !!selectedDate && guestCount > 0;
      case 2:
        return !!selectedTime;
      case 3:
        return true; // Table selection is optional
      case 4:
        return !!customerInfo.name.trim() && !!customerInfo.phone.trim();
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step === 4 && !validateCustomerInfo()) return;
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setValidationErrors({});
    }
  };

  const handleSubmit = async () => {
    if (!tenantId) return;

    const data: CreateReservationDto = {
      date: selectedDate,
      startTime: selectedTime,
      endTime: selectedEndTime,
      guestCount,
      customerName: customerInfo.name.trim(),
      customerPhone: customerInfo.phone.trim(),
      customerEmail: customerInfo.email.trim() || undefined,
      notes: customerInfo.notes.trim() || undefined,
      tableId: selectedTable?.id,
    };

    try {
      const reservation = await createReservation.mutateAsync({ tenantId, data });
      setCreatedReservation(reservation);
    } catch {
      // Error is handled by the mutation state
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${minutes} ${ampm}`;
  };

  // Map backend error messages to i18n keys
  const getErrorMessage = (error: any): string => {
    const serverMessage = error?.response?.data?.message;
    if (!serverMessage) return t('public.submitError');

    const errorMap: Record<string, string> = {
      'Tenant not found': t('public.errors.tenantNotFound'),
      'Tenant is not active': t('public.errors.tenantNotActive'),
      'Reservation system is not enabled': t('public.errors.systemDisabled'),
      'End time must be after start time': t('public.errors.invalidTime'),
      'Cannot book past dates': t('public.errors.pastDate'),
      'You already have a reservation for this time slot': t('public.errors.duplicate'),
      'This time slot is fully booked': t('public.errors.slotFull'),
      'Restaurant is closed on this day': t('public.errors.closedDay'),
      'Reservation time is too soon. Please book further in advance.': t('public.errors.tooSoon'),
    };

    return errorMap[serverMessage] || serverMessage;
  };

  // Loading state
  if (settingsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Settings fetch error (tenant not found, not active, etc.)
  if (!settingsLoading && !settings) {
    const errorStatus = (settingsError as any)?.response?.status;
    const errorMessage = (settingsError as any)?.response?.data?.message;
    let displayError = t('public.errors.tenantNotFound');
    if (errorStatus === 403 || errorMessage === 'Tenant is not active') {
      displayError = t('public.errors.tenantNotActive');
    }
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {displayError}
          </h2>
        </div>
      </div>
    );
  }

  // System disabled
  if (settings && !settings.isEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {t('public.systemDisabled')}
          </h2>
        </div>
      </div>
    );
  }

  // Step indicator
  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center">
          <div
            className={`w-3 h-3 rounded-full transition-colors ${
              s === step
                ? 'bg-blue-600 ring-4 ring-blue-100'
                : s < step
                  ? 'bg-blue-600'
                  : 'bg-gray-200'
            }`}
          />
          {s < TOTAL_STEPS && (
            <div
              className={`w-8 h-0.5 ${s < step ? 'bg-blue-600' : 'bg-gray-200'}`}
            />
          )}
        </div>
      ))}
      <span className="ms-3 text-sm text-gray-500">
        {t('public.step')} {step} {t('public.of')} {TOTAL_STEPS}
      </span>
    </div>
  );

  // Step 1: Date & Guest Count
  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
          <CalendarDays className="w-5 h-5 text-blue-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">{t('public.selectDate')}</h2>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('public.selectDate')}
        </label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => handleDateChange(e.target.value)}
          min={minDate}
          max={maxDate || undefined}
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-base"
        />
      </div>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-purple-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">{t('public.selectGuests')}</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          {Array.from(
            { length: settings?.maxGuestsPerReservation || 10 },
            (_, i) => i + 1
          ).map((count) => (
            <button
              key={count}
              onClick={() => handleGuestCountChange(count)}
              className={`w-14 h-14 rounded-xl font-semibold text-lg transition-all ${
                guestCount === count
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                  : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {count}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-500">
          {guestCount} {guestCount === 1 ? t('public.guest') : t('public.guests')}
        </p>
      </div>
    </div>
  );

  // Step 2: Time Selection
  const renderStep2 = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
          <Clock className="w-5 h-5 text-orange-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">{t('public.selectTime')}</h2>
      </div>

      <p className="text-sm text-gray-500 mb-4">{formatDate(selectedDate)}</p>

      {slotsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      ) : !availableSlots || availableSlots.length === 0 ? (
        <div className="text-center py-12">
          <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{t('public.noSlotsAvailable')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {availableSlots.map((slot) => (
            <button
              key={slot.time}
              onClick={() => slot.available && handleTimeSelect(slot.time)}
              disabled={!slot.available}
              className={`px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                selectedTime === slot.time
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                  : slot.available
                    ? 'bg-white border-2 border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-400'
                    : 'bg-gray-50 border-2 border-gray-100 text-gray-300 cursor-not-allowed'
              }`}
            >
              {formatTime(slot.time)}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Step 3: Table Selection (Optional)
  const renderStep3 = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
          <MapPin className="w-5 h-5 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">{t('public.selectTable')}</h2>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        {formatDate(selectedDate)} &middot; {formatTime(selectedTime)}
      </p>

      {/* Skip / Any table option */}
      <button
        onClick={() => setSelectedTable(null)}
        className={`w-full px-4 py-3 rounded-xl text-sm font-medium transition-all text-start ${
          selectedTable === null
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
            : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-blue-300'
        }`}
      >
        {t('public.anyTable')}
      </button>

      {tablesLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      ) : !availableTables || availableTables.length === 0 ? (
        <div className="text-center py-8">
          <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{t('public.noTablesAvailable')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {availableTables.map((table) => (
            <button
              key={table.id}
              onClick={() => setSelectedTable(table)}
              className={`p-4 rounded-xl text-start transition-all ${
                selectedTable?.id === table.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                  : 'bg-white border-2 border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p
                    className={`font-semibold ${
                      selectedTable?.id === table.id ? 'text-white' : 'text-gray-900'
                    }`}
                  >
                    {t('detail.table')} {table.number}
                  </p>
                  {table.section && (
                    <p
                      className={`text-sm mt-0.5 ${
                        selectedTable?.id === table.id ? 'text-blue-100' : 'text-gray-500'
                      }`}
                    >
                      {table.section}
                    </p>
                  )}
                </div>
                <div
                  className={`flex items-center gap-1 text-sm ${
                    selectedTable?.id === table.id ? 'text-blue-100' : 'text-gray-500'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>{table.capacity}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Step 4: Customer Info
  const renderStep4 = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
          <User className="w-5 h-5 text-indigo-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">{t('public.yourInfo')}</h2>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t('public.name')} *
        </label>
        <input
          type="text"
          value={customerInfo.name}
          onChange={(e) => {
            setCustomerInfo({ ...customerInfo, name: e.target.value });
            if (validationErrors.name) {
              setValidationErrors({ ...validationErrors, name: '' });
            }
          }}
          className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 ${
            validationErrors.name ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
          placeholder={t('public.name')}
        />
        {validationErrors.name && (
          <p className="mt-1 text-sm text-red-600">{validationErrors.name}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t('public.phone')} *
        </label>
        <input
          type="tel"
          value={customerInfo.phone}
          onChange={(e) => {
            setCustomerInfo({ ...customerInfo, phone: e.target.value });
            if (validationErrors.phone) {
              setValidationErrors({ ...validationErrors, phone: '' });
            }
          }}
          className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 ${
            validationErrors.phone ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
          placeholder={t('public.phone')}
        />
        {validationErrors.phone && (
          <p className="mt-1 text-sm text-red-600">{validationErrors.phone}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t('public.email')}
        </label>
        <input
          type="email"
          value={customerInfo.email}
          onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
          placeholder={t('public.email')}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {t('public.notes')}
        </label>
        <textarea
          value={customerInfo.notes}
          onChange={(e) => setCustomerInfo({ ...customerInfo, notes: e.target.value })}
          rows={3}
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 resize-none"
          placeholder={t('public.notes')}
        />
      </div>
    </div>
  );

  // Step 5: Confirmation
  const renderStep5 = () => {
    // Successfully created
    if (createdReservation) {
      const isPending = createdReservation.status === 'PENDING';
      return (
        <div className="text-center py-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isPending ? t('public.successPending') : t('public.success')}
          </h2>
          <p className="text-gray-600 mb-6">
            {isPending ? t('public.pendingMessage') : t('public.confirmedMessage')}
          </p>

          <div className="bg-gray-50 rounded-xl p-6 mb-6 text-start max-w-sm mx-auto">
            <p className="text-sm text-gray-500 mb-1">{t('public.successMessage')}</p>
            <p className="text-3xl font-bold text-blue-600 mb-4">
              {createdReservation.reservationNumber}
            </p>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-gray-700">
                <CalendarDays className="w-4 h-4 text-gray-400" />
                <span>{formatDate(createdReservation.date)}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-700">
                <Clock className="w-4 h-4 text-gray-400" />
                <span>
                  {formatTime(createdReservation.startTime)} -{' '}
                  {formatTime(createdReservation.endTime)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-gray-700">
                <Users className="w-4 h-4 text-gray-400" />
                <span>
                  {createdReservation.guestCount}{' '}
                  {createdReservation.guestCount === 1 ? t('public.guest') : t('public.guests')}
                </span>
              </div>
              {createdReservation.table && (
                <div className="flex items-center gap-2 text-gray-700">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span>
                    {t('detail.table')} {createdReservation.table.number}
                  </span>
                </div>
              )}
            </div>
          </div>

          <Link
            to={`/reserve/${tenantId}/lookup`}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline"
          >
            {t('lookup.title')}
          </Link>
        </div>
      );
    }

    // Summary before submit
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
            <Check className="w-5 h-5 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">
            {t('public.submit')}
          </h2>
        </div>

        <div className="bg-gray-50 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <CalendarDays className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">{t('detail.date')}</p>
              <p className="font-medium text-gray-900">{formatDate(selectedDate)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">{t('detail.time')}</p>
              <p className="font-medium text-gray-900">
                {formatTime(selectedTime)} - {formatTime(selectedEndTime)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">{t('detail.guests')}</p>
              <p className="font-medium text-gray-900">
                {guestCount} {guestCount === 1 ? t('public.guest') : t('public.guests')}
              </p>
            </div>
          </div>

          {selectedTable && (
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-500">{t('detail.table')}</p>
                <p className="font-medium text-gray-900">
                  {t('detail.table')} {selectedTable.number}
                  {selectedTable.section && ` - ${selectedTable.section}`}
                </p>
              </div>
            </div>
          )}

          <hr className="border-gray-200" />

          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-gray-400" />
            <div>
              <p className="text-sm text-gray-500">{t('detail.customer')}</p>
              <p className="font-medium text-gray-900">{customerInfo.name}</p>
              <p className="text-sm text-gray-600">{customerInfo.phone}</p>
              {customerInfo.email && (
                <p className="text-sm text-gray-600">{customerInfo.email}</p>
              )}
            </div>
          </div>

          {customerInfo.notes && (
            <div>
              <p className="text-sm text-gray-500">{t('detail.notes')}</p>
              <p className="text-sm text-gray-700 mt-1">{customerInfo.notes}</p>
            </div>
          )}
        </div>

        {createReservation.isError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">
              {getErrorMessage(createReservation.error)}
            </p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={createReservation.isPending}
          className="w-full py-3.5 bg-blue-600 text-white rounded-xl font-semibold text-base hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {createReservation.isPending ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t('public.submitting')}</span>
            </>
          ) : (
            <>
              <Check className="w-5 h-5" />
              <span>{t('public.submit')}</span>
            </>
          )}
        </button>
      </div>
    );
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return renderStep1();
      case 2:
        return renderStep2();
      case 3:
        return renderStep3();
      case 4:
        return renderStep4();
      case 5:
        return renderStep5();
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Banner */}
      {(settings?.bannerTitle || settings?.bannerDescription || settings?.bannerImageUrl) && (
        <div
          className="relative bg-blue-600 text-white"
          style={
            settings.bannerImageUrl
              ? {
                  backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${settings.bannerImageUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
          }
        >
          <div className="max-w-2xl mx-auto px-4 py-12 text-center">
            {settings.bannerTitle && (
              <h1 className="text-3xl font-bold mb-2">{settings.bannerTitle}</h1>
            )}
            {settings.bannerDescription && (
              <p className="text-blue-100 text-lg">{settings.bannerDescription}</p>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Title (if no banner) */}
        {!settings?.bannerTitle && (
          <h1 className="text-2xl font-bold text-gray-900 text-center mb-8">
            {t('public.title')}
          </h1>
        )}

        {/* Custom message */}
        {settings?.customMessage && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-8 text-center">
            <p className="text-sm text-blue-800">{settings.customMessage}</p>
          </div>
        )}

        {/* Step indicator */}
        {!createdReservation && renderStepIndicator()}

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {renderStep()}

          {/* Navigation buttons (not shown on step 5 or after creation) */}
          {step < 5 && (
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
              <button
                onClick={handleBack}
                disabled={step === 1}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-colors ${
                  step === 1
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                {t('public.back')}
              </button>

              <button
                onClick={handleNext}
                disabled={!canGoNext()}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('public.next')}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Lookup link */}
        {!createdReservation && (
          <div className="text-center mt-6">
            <Link
              to={`/reserve/${tenantId}/lookup`}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium hover:underline"
            >
              {t('lookup.title')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicReservationPage;
