import { useTranslation } from 'react-i18next';
import ShippingAddressForm from '../hardware-store/ShippingAddressForm';
import type { ShippingAddress } from '../hardware-store/storeApi';
import type { Branch } from '../branches/branchesApi';

const NOTES_MAX_LENGTH = 500;

/**
 * Sihirbaz adım 2 — teslimat.
 *
 * Mevcut ShippingAddressForm AYNEN yeniden kullanılıyor (şubeye gönder /
 * manuel adres, branchId döndürür); tek eklenen şey üretim notu.
 *
 * Not üst sınırı 500: backend CartItemDto.notes @MaxLength(500) taşıyor,
 * yani burada sınırlamazsak alıcı yazdıklarını ödemede 400 olarak görür.
 * `maxLength` HTML özniteliği gerçek klavye girişini keser; programatik
 * `value` ataması (ör. yapıştırma) tarayıcıda da kesilir çünkü kontrollü
 * `<textarea>` her onChange'te DOM'un kendi maxLength davranışına uyar.
 *
 * Not durumu DIŞARIDA (`notes` + `onNotesChange`) yaşar — sihirbaz onu
 * adımlar arasında taşır, tıpkı `selected` seçim listesinin adım 1'de
 * yaptığı gibi. Bileşen kendi kopyasını tutmaz; sayaç ve textarea DEĞERİ
 * her zaman `notes` prop'undan okunur, böylece gösterilen ile sihirbazın
 * gönderdiği asla ayrışmaz.
 */
export default function Print3dShippingStep({
  branches,
  initialAddress,
  notes,
  onNotesChange,
  onSubmit,
  submitting,
}: {
  branches: Branch[];
  initialAddress?: ShippingAddress;
  notes: string;
  onNotesChange: (v: string) => void;
  onSubmit: (r: { address: ShippingAddress; branchId?: string }) => void;
  submitting?: boolean;
}) {
  const { t } = useTranslation('hardware');
  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="print3d-notes"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          {t('print3d.shipping.notesLabel')}
        </label>
        <textarea
          id="print3d-notes"
          rows={3}
          maxLength={NOTES_MAX_LENGTH}
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder={t('print3d.shipping.notesPlaceholder')}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value.slice(0, NOTES_MAX_LENGTH))}
        />
        <p className="mt-1 text-right text-[11px] text-gray-400">
          {notes.length}/{NOTES_MAX_LENGTH}
        </p>
      </div>

      <ShippingAddressForm
        initial={initialAddress}
        branches={branches}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel={t('print3d.shipping.continue')}
      />
    </div>
  );
}
