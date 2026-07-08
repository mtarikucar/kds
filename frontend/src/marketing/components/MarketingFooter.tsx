import { Link } from "react-router-dom";
import { ChefHat } from "lucide-react";
import { display } from "../theme";
import { MODULES } from "../data/modules";

export default function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[#ece2d4] bg-[#f7f1e8]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="max-w-xs">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f97316] text-white">
              <ChefHat className="h-4 w-4" />
            </span>
            <span className="font-semibold text-[#1c1917]" style={display}>
              HummyTummy
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[#78716c]">
            Bulut tabanlı restoran yönetim sistemi — QR menü, POS, mutfak ekranı
            (KDS), sipariş, masa ve stok yönetimi tek panelde.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1c1917]">Özellikler</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {MODULES.map((m) => (
              <li key={m.slug}>
                <Link
                  to={`/ozellikler/${m.slug}`}
                  className="text-[#57534e] transition hover:text-[#1c1917]"
                >
                  {m.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1c1917]">Kurumsal</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                to="/ozellikler"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Tüm Özellikler
              </Link>
            </li>
            <li>
              <Link
                to="/kurumsal"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Hakkımızda
              </Link>
            </li>
            <li>
              <Link
                to="/entegrasyonlar"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Entegrasyonlar
              </Link>
            </li>
            <li>
              <Link
                to="/fiyatlandirma"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Fiyatlandırma
              </Link>
            </li>
            <li>
              <Link
                to="/register"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Ücretsiz Dene
              </Link>
            </li>
            <li>
              <a
                href="https://help.hummytummy.com"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Yardım Merkezi
              </a>
            </li>
            <li>
              <a
                href="https://developer.hummytummy.com"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Geliştirici
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[#1c1917]">Yasal</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                to="/privacy"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Gizlilik Politikası
              </Link>
            </li>
            <li>
              <Link to="/terms" className="text-[#57534e] hover:text-[#1c1917]">
                Kullanım Şartları
              </Link>
            </li>
            <li>
              <Link
                to="/legal/kvkk"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                KVKK
              </Link>
            </li>
            <li>
              <Link
                to="/legal/distance-sales"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                Mesafeli Satış
              </Link>
            </li>
            <li>
              <Link
                to="/legal/refund-policy"
                className="text-[#57534e] hover:text-[#1c1917]"
              >
                İade Politikası
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-[#ece2d4] py-5 text-center text-xs text-[#a8a29e]">
        © {year} HummyTummy · Tüm hakları saklıdır.
      </div>
    </footer>
  );
}
