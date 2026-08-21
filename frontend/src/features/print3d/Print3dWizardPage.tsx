import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProducts } from '../menu/menuApi';
import { useListBranches } from '../branches/branchesApi';
import {
  useCreateCheckoutIntent,
  useQuoteCart,
  type CartItem,
  type ShippingAddress,
} from '../hardware-store/storeApi';
import { stashPendingCheckoutRef } from '../hardware-store/checkoutRef';
import { useAuthStore } from '../../store/authStore';
import { useGetPrint3dOffer } from './print3dApi';
import { PRINT3D_BASE_SKU, PRINT3D_ITEM_SKU } from './print3dSkus';
import Print3dProductPicker from './Print3dProductPicker';
import Print3dShippingStep from './Print3dShippingStep';
import Print3dSummary from './Print3dSummary';
import PartnerBadge from './PartnerBadge';

/**
 * /admin/store/print3d — bağımsız üç adımlı sihirbaz.
 *
 * PAYLAŞILAN cartStore KULLANILMAZ: o mağazanın sepeti hizmet satırlarının
 * adedini yönetmiyor (setQty hizmet satırına dokunmuyor), yani çoklu-ürün
 * adedi oradan ifade edilemez. Sihirbaz kendi İKİ satırlık sepetini üretir:
 *
 *   [ { service print3d_base, qty 1 },
 *     { service print3d_item, qty N, productIds: [...] } ]
 *
 * qty burada yalnızca nezaket; sunucu adedi productIds'ten türetir.
 *
 * Adım 1 → 2 geçişi kapısı BURADA yaşar (Görev 16 bilinçli olarak
 * Print3dProductPicker'ın dışında bıraktı — bkz. o dosyanın başlık
 * yorumu): "Devam et" düğmesi selected.length [minItems, maxItems]
 * aralığının dışındayken kilitli kalır. Alt sınır sıfır seçimi ("hiçbir
 * şey seçilmeden devam") engeller; üst sınır zaten Picker'ın kendi tavan
 * disable'ıyla pratikte hiç aşılmaz ama sunucunun PRINT3D_TOO_MANY_PRODUCTS
 * hatasıyla aynı sınırı burada da tekrarlamak, olası bir state
 * tutarsızlığında bile alıcının "geçersiz sepet" hatasıyla ödemeye
 * gitmesini önler.
 */
export default function Print3dWizardPage() {
  const { t } = useTranslation('hardware');
  const user = useAuthStore((s) => s.user);
  const { data: offer } = useGetPrint3dOffer();
  const { data: products = [] } = useProducts();
  const { data: branches = [] } = useListBranches();
  const quote = useQuoteCart();
  const intent = useCreateCheckoutIntent();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState<ShippingAddress | null>(null);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [serverTotalCents, setServerTotalCents] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (!offer?.available) {
    return (
      <div className="space-y-3 p-6">
        <Link to="/admin/store?tab=hardware" className="text-sm text-blue-600 hover:underline">
          {t('common.backToStore')}
        </Link>
        <p className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('print3d.wizard.unavailable')}
        </p>
      </div>
    );
  }

  // Adet [minItems, maxItems] aralığının DIŞINDAYKEN "Devam et" kilitli.
  // maxItems denetimi Picker'ın disable'ıyla örtüşür — kasıtlı çiftleme,
  // yerel state hiçbir yoldan sunucunun tavanını aşmasın diye.
  const withinRange =
    selected.length >= offer.minItems && selected.length <= offer.maxItems;

  /** Sunucuya gidecek İKİ satır. Tek üretim yeri — sapma olmasın. */
  const buildCartItems = (): CartItem[] => [
    { type: 'service', code: PRINT3D_BASE_SKU, qty: 1, branchId },
    {
      type: 'service',
      code: PRINT3D_ITEM_SKU,
      qty: selected.length,
      branchId,
      productIds: selected,
      notes: notes.trim() || undefined,
    },
  ];

  async function onShippingSubmit(r: { address: ShippingAddress; branchId?: string }) {
    setAddress(r.address);
    setBranchId(r.branchId);
    setStep(3);
    // Özete geçerken SUNUCU TOPLAMINI iste. İstemci aritmetiği yalnızca
    // önizlemedir; Öde düğmesi bu yanıt gelene kadar kilitli kalır.
    setVerifying(true);
    setServerTotalCents(null);
    try {
      const q = await quote.mutateAsync({
        items: [
          { type: 'service', code: PRINT3D_BASE_SKU, qty: 1, branchId: r.branchId },
          {
            type: 'service',
            code: PRINT3D_ITEM_SKU,
            qty: selected.length,
            branchId: r.branchId,
            productIds: selected,
            notes: notes.trim() || undefined,
          },
        ],
      });
      setServerTotalCents(q.totalCents);
    } finally {
      setVerifying(false);
    }
  }

  async function pay() {
    if (!user || !address) return;
    const result = await intent.mutateAsync({
      cart: { items: buildCartItems(), shippingAddress: address },
      buyer: {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim() || user.email,
        phone: user.phone ?? '',
        address: `${address.line1}, ${address.city}`,
      },
      returnUrl: `${window.location.origin}/admin/store?tab=hardware&intent=pending`,
      branchId,
      acceptedDocumentIds: accepted,
    });
    stashPendingCheckoutRef(result.paymentRef);
    if (result.paymentLink) window.location.assign(result.paymentLink);
  }

  return (
    <div className="space-y-4 p-6">
      <Link to="/admin/store?tab=hardware" className="text-sm text-blue-600 hover:underline">
        {t('common.backToStore')}
      </Link>

      <header className="space-y-1">
        <h1 className="text-lg font-semibold">{t('print3d.wizard.title')}</h1>
        <PartnerBadge url={offer.partnerUrl} />
        <ol className="flex flex-wrap gap-3 pt-2 text-xs">
          {[
            t('print3d.wizard.stepProducts'),
            t('print3d.wizard.stepShipping'),
            t('print3d.wizard.stepSummary'),
          ].map((label, i) => (
            <li
              key={label}
              className={
                step === i + 1 ? 'font-semibold text-violet-700' : 'text-gray-400'
              }
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </header>

      {step === 1 && (
        <>
          <Print3dProductPicker
            products={products}
            selected={selected}
            onChange={setSelected}
            maxSelection={offer.maxItems}
            basePriceCents={offer.basePriceCents}
            perItemCents={offer.perItemCents}
            currency={offer.currency}
          />
          <button
            type="button"
            disabled={!withinRange}
            onClick={() => withinRange && setStep(2)}
            className="rounded bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {t('print3d.wizard.next')}
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <Print3dShippingStep
            branches={branches}
            initialAddress={address ?? undefined}
            notes={notes}
            onNotesChange={setNotes}
            onSubmit={onShippingSubmit}
            submitting={quote.isPending}
          />
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-sm text-gray-600 hover:underline"
          >
            {t('print3d.wizard.back')}
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <Print3dSummary
            itemCount={selected.length}
            basePriceCents={offer.basePriceCents}
            perItemCents={offer.perItemCents}
            currency={offer.currency}
            partnerUrl={offer.partnerUrl}
            accepted={accepted}
            onAcceptedChange={setAccepted}
            serverTotalCents={serverTotalCents}
            verifying={verifying}
            onPay={pay}
            paying={intent.isPending}
          />
          <button
            type="button"
            onClick={() => setStep(2)}
            className="text-sm text-gray-600 hover:underline"
          >
            {t('print3d.wizard.back')}
          </button>
        </>
      )}
    </div>
  );
}
