import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChefHat } from 'lucide-react';

const TermsOfServicePage: React.FC = () => {
  const { t, i18n } = useTranslation('legal');
  const isEnglish = i18n.language === 'en';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-primary-600 hover:text-primary-700">
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">{t('backToHome', 'Back to Home')}</span>
          </Link>
          <div className="flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-primary-600" />
            <span className="font-heading font-bold text-slate-900">HummyTummy</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <div className="bg-white rounded-2xl shadow-sm p-6 md:p-10">
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-slate-900 mb-2">
            {isEnglish ? 'Terms of Service' : 'Hizmet Şartları'}
          </h1>
          <p className="text-slate-500 mb-8">
            {isEnglish ? 'Last updated: December 2024' : 'Son güncelleme: Aralık 2024'}
          </p>

          <div className="prose prose-gray max-w-none">
            {isEnglish ? (
              <>
                <h2>1. Acceptance of Terms</h2>
                <p>
                  By accessing and using HummyTummy ("Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.
                </p>

                <h2>2. Description of Service</h2>
                <p>
                  HummyTummy provides a cloud-based restaurant management platform including point of sale (POS), kitchen display system, table management, QR menu ordering, and related services for restaurant businesses.
                </p>

                <h2>3. User Account</h2>
                <p>
                  To use certain features of the Service, you must register for an account. You agree to provide accurate, current, and complete information during the registration process and to update such information to keep it accurate, current, and complete.
                </p>
                <ul>
                  <li>You are responsible for safeguarding your password</li>
                  <li>You agree not to disclose your password to any third party</li>
                  <li>You must notify us immediately upon becoming aware of any breach of security</li>
                </ul>

                <h2>4. Subscription and Payment</h2>
                <p>
                  Some aspects of the Service are provided for a fee. You will be charged in accordance with the pricing plan you select. All fees are exclusive of applicable taxes.
                </p>
                <ul>
                  <li>Subscription fees are billed in advance on a monthly or annual basis</li>
                  <li>No refunds will be issued for partial months of service</li>
                  <li>You may cancel your subscription at any time</li>
                </ul>

                <h2>5. Acceptable Use</h2>
                <p>You agree not to use the Service to:</p>
                <ul>
                  <li>Violate any laws or regulations</li>
                  <li>Infringe on the rights of others</li>
                  <li>Transmit harmful code or interfere with the Service</li>
                  <li>Attempt to gain unauthorized access to the Service</li>
                </ul>

                <h2>6. Data and Privacy</h2>
                <p>
                  Your use of the Service is also governed by our Privacy Policy. By using the Service, you consent to the collection and use of information as detailed in the Privacy Policy.
                </p>

                <h2>7. Intellectual Property</h2>
                <p>
                  The Service and its original content, features, and functionality are and will remain the exclusive property of HummyTummy. The Service is protected by copyright, trademark, and other laws.
                </p>

                <h2>8. Limitation of Liability</h2>
                <p>
                  In no event shall HummyTummy be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, or other intangible losses.
                </p>

                <h2>9. Termination</h2>
                <p>
                  We may terminate or suspend your account immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.
                </p>

                <h2>10. Changes to Terms</h2>
                <p>
                  We reserve the right to modify or replace these Terms at any time. If a revision is material, we will try to provide at least 30 days' notice prior to any new terms taking effect.
                </p>

                <h2>11. Contact Us</h2>
                <p>
                  If you have any questions about these Terms, please contact us at:
                </p>
                <p>
                  <strong>Email:</strong> support@hummytummy.com<br />
                  <strong>Website:</strong> https://hummytummy.com
                </p>
              </>
            ) : (
              <>
                <h2>1. Şartların Kabulü</h2>
                <p>
                  HummyTummy'ye ("Hizmet") erişerek ve kullanarak, bu sözleşmenin şartlarını ve hükümlerini kabul etmiş olursunuz. Yukarıdakilere uymayı kabul etmiyorsanız, lütfen bu hizmeti kullanmayın.
                </p>

                <h2>2. Hizmet Açıklaması</h2>
                <p>
                  HummyTummy, restoran işletmeleri için satış noktası (POS), mutfak ekran sistemi, masa yönetimi, QR menü siparişi ve ilgili hizmetler dahil olmak üzere bulut tabanlı bir restoran yönetim platformu sağlar.
                </p>

                <h2>3. Kullanıcı Hesabı</h2>
                <p>
                  Hizmetin belirli özelliklerini kullanmak için bir hesap oluşturmanız gerekmektedir. Kayıt işlemi sırasında doğru, güncel ve eksiksiz bilgi vermeyi ve bu bilgileri doğru, güncel ve eksiksiz tutmak için güncellemeyi kabul edersiniz.
                </p>
                <ul>
                  <li>Şifrenizi korumaktan siz sorumlusunuz</li>
                  <li>Şifrenizi üçüncü şahıslara açıklamamayı kabul edersiniz</li>
                  <li>Herhangi bir güvenlik ihlalinden haberdar olduğunuzda bizi derhal bilgilendirmelisiniz</li>
                </ul>

                <h2>4. Abonelik ve Ödeme</h2>
                <p>
                  Hizmetin bazı yönleri ücretli olarak sunulmaktadır. Seçtiğiniz fiyatlandırma planına göre ücretlendirileceksiniz. Tüm ücretler geçerli vergiler hariçtir.
                </p>
                <ul>
                  <li>Abonelik ücretleri aylık veya yıllık olarak peşin faturalandırılır</li>
                  <li>Kısmi hizmet ayları için iade yapılmayacaktır</li>
                  <li>Aboneliğinizi istediğiniz zaman iptal edebilirsiniz</li>
                </ul>

                <h2>5. Kabul Edilebilir Kullanım</h2>
                <p>Hizmeti aşağıdaki amaçlarla kullanmamayı kabul edersiniz:</p>
                <ul>
                  <li>Yasa veya düzenlemeleri ihlal etmek</li>
                  <li>Başkalarının haklarını ihlal etmek</li>
                  <li>Zararlı kod iletmek veya Hizmete müdahale etmek</li>
                  <li>Hizmete yetkisiz erişim sağlamaya çalışmak</li>
                </ul>

                <h2>6. Veri ve Gizlilik</h2>
                <p>
                  Hizmeti kullanımınız ayrıca Gizlilik Politikamız tarafından yönetilmektedir. Hizmeti kullanarak, Gizlilik Politikasında belirtildiği şekilde bilgilerin toplanmasına ve kullanılmasına onay vermiş olursunuz.
                </p>

                <h2>7. Fikri Mülkiyet</h2>
                <p>
                  Hizmet ve orijinal içeriği, özellikleri ve işlevselliği HummyTummy'nin münhasır mülkiyetindedir ve öyle kalacaktır. Hizmet telif hakkı, ticari marka ve diğer yasalarla korunmaktadır.
                </p>

                <h2>8. Sorumluluk Sınırlaması</h2>
                <p>
                  Hiçbir durumda HummyTummy, kar kaybı, veri kaybı veya diğer maddi olmayan kayıplar dahil ancak bunlarla sınırlı olmamak üzere, dolaylı, arızi, özel, sonuçsal veya cezai zararlardan sorumlu tutulamaz.
                </p>

                <h2>9. Fesih</h2>
                <p>
                  Şartları ihlal etmeniz dahil ancak bununla sınırlı olmamak üzere herhangi bir nedenle, önceden bildirimde bulunmaksızın veya sorumluluk almaksızın hesabınızı derhal feshedebilir veya askıya alabiliriz.
                </p>

                <h2>10. Şartlardaki Değişiklikler</h2>
                <p>
                  Bu Şartları herhangi bir zamanda değiştirme veya değiştirme hakkımızı saklı tutarız. Bir revizyon önemliyse, yeni şartlar yürürlüğe girmeden en az 30 gün önce bildirimde bulunmaya çalışacağız.
                </p>

                <h2>11. Bize Ulaşın</h2>
                <p>
                  Bu Şartlar hakkında sorularınız varsa, lütfen bizimle iletişime geçin:
                </p>
                <p>
                  <strong>E-posta:</strong> support@hummytummy.com<br />
                  <strong>Web sitesi:</strong> https://hummytummy.com
                </p>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-8 mt-12">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-slate-400">
            © {new Date().getFullYear()} HummyTummy. {isEnglish ? 'All rights reserved.' : 'Tüm hakları saklıdır.'}
          </p>
          <div className="flex justify-center gap-6 mt-4">
            <Link to="/privacy" className="text-slate-400 hover:text-white transition-colors">
              {isEnglish ? 'Privacy Policy' : 'Gizlilik Politikası'}
            </Link>
            <Link to="/terms" className="text-primary-400 hover:text-primary-300 transition-colors">
              {isEnglish ? 'Terms of Service' : 'Hizmet Şartları'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default TermsOfServicePage;
