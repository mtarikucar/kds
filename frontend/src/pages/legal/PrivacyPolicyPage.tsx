import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChefHat } from 'lucide-react';

const PrivacyPolicyPage: React.FC = () => {
  const { i18n } = useTranslation();
  const isEnglish = i18n.language === 'en';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-primary-600 hover:text-primary-700">
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">{isEnglish ? 'Back to Home' : 'Ana Sayfaya Dön'}</span>
          </Link>
          <div className="flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-primary-600" />
            <span className="font-heading font-bold text-gray-900">HummyTummy</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <div className="bg-white rounded-2xl shadow-sm p-6 md:p-10">
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-gray-900 mb-2">
            {isEnglish ? 'Privacy Policy' : 'Gizlilik Politikası'}
          </h1>
          <p className="text-gray-500 mb-8">
            {isEnglish ? 'Last updated: December 2024' : 'Son güncelleme: Aralık 2024'}
          </p>

          <div className="prose prose-gray max-w-none">
            {isEnglish ? (
              <>
                <h2>1. Introduction</h2>
                <p>
                  HummyTummy ("we", "our", or "us") respects your privacy and is committed to protecting your personal data. This privacy policy will inform you about how we look after your personal data when you visit our website or use our services.
                </p>

                <h2>2. Data We Collect</h2>
                <p>We may collect, use, store and transfer different kinds of personal data about you:</p>
                <ul>
                  <li><strong>Identity Data:</strong> First name, last name, username</li>
                  <li><strong>Contact Data:</strong> Email address, telephone numbers</li>
                  <li><strong>Technical Data:</strong> IP address, browser type and version, time zone setting, operating system</li>
                  <li><strong>Usage Data:</strong> Information about how you use our website and services</li>
                  <li><strong>Business Data:</strong> Restaurant information, menu items, orders, transactions</li>
                </ul>

                <h2>3. How We Use Your Data</h2>
                <p>We use your personal data for the following purposes:</p>
                <ul>
                  <li>To provide and maintain our Service</li>
                  <li>To notify you about changes to our Service</li>
                  <li>To provide customer support</li>
                  <li>To gather analysis or valuable information to improve our Service</li>
                  <li>To monitor the usage of our Service</li>
                  <li>To detect, prevent and address technical issues</li>
                  <li>To process payments and manage subscriptions</li>
                </ul>

                <h2>4. Data Security</h2>
                <p>
                  We have implemented appropriate security measures to prevent your personal data from being accidentally lost, used or accessed in an unauthorized way, altered or disclosed. We use industry-standard encryption to protect data transmission and storage.
                </p>

                <h2>5. Data Retention</h2>
                <p>
                  We will only retain your personal data for as long as necessary to fulfill the purposes we collected it for, including for the purposes of satisfying any legal, accounting, or reporting requirements.
                </p>

                <h2>6. Your Rights</h2>
                <p>Under certain circumstances, you have rights under data protection laws in relation to your personal data:</p>
                <ul>
                  <li><strong>Right to access:</strong> Request access to your personal data</li>
                  <li><strong>Right to correction:</strong> Request correction of inaccurate data</li>
                  <li><strong>Right to erasure:</strong> Request deletion of your personal data</li>
                  <li><strong>Right to restrict processing:</strong> Request restriction of processing</li>
                  <li><strong>Right to data portability:</strong> Request transfer of your data</li>
                  <li><strong>Right to object:</strong> Object to processing of your personal data</li>
                </ul>

                <h2>7. Cookies</h2>
                <p>
                  We use cookies and similar tracking technologies to track activity on our Service and hold certain information. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent.
                </p>

                <h2>8. Third-Party Services</h2>
                <p>
                  We may use third-party service providers to monitor and analyze the use of our Service, process payments, and provide other services:
                </p>
                <ul>
                  <li><strong>Payment Processors:</strong> Stripe, Iyzico</li>
                  <li><strong>Analytics:</strong> Google Analytics</li>
                  <li><strong>Cloud Services:</strong> For hosting and data storage</li>
                </ul>

                <h2>9. Children's Privacy</h2>
                <p>
                  Our Service does not address anyone under the age of 18. We do not knowingly collect personally identifiable information from anyone under the age of 18.
                </p>

                <h2>10. Changes to This Policy</h2>
                <p>
                  We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
                </p>

                <h2>11. Contact Us</h2>
                <p>
                  If you have any questions about this Privacy Policy, please contact us:
                </p>
                <p>
                  <strong>Email:</strong> privacy@hummytummy.com<br />
                  <strong>Website:</strong> https://hummytummy.com
                </p>
              </>
            ) : (
              <>
                <h2>1. Giriş</h2>
                <p>
                  HummyTummy ("biz", "bizim" veya "bize") gizliliğinize saygı duyar ve kişisel verilerinizi korumayı taahhüt eder. Bu gizlilik politikası, web sitemizi ziyaret ettiğinizde veya hizmetlerimizi kullandığınızda kişisel verilerinize nasıl baktığımız hakkında sizi bilgilendirecektir.
                </p>

                <h2>2. Topladığımız Veriler</h2>
                <p>Hakkınızda farklı türde kişisel veriler toplayabilir, kullanabilir, saklayabilir ve aktarabiliriz:</p>
                <ul>
                  <li><strong>Kimlik Verileri:</strong> Ad, soyad, kullanıcı adı</li>
                  <li><strong>İletişim Verileri:</strong> E-posta adresi, telefon numaraları</li>
                  <li><strong>Teknik Veriler:</strong> IP adresi, tarayıcı türü ve sürümü, zaman dilimi ayarı, işletim sistemi</li>
                  <li><strong>Kullanım Verileri:</strong> Web sitemizi ve hizmetlerimizi nasıl kullandığınıza dair bilgiler</li>
                  <li><strong>İş Verileri:</strong> Restoran bilgileri, menü öğeleri, siparişler, işlemler</li>
                </ul>

                <h2>3. Verilerinizi Nasıl Kullanıyoruz</h2>
                <p>Kişisel verilerinizi aşağıdaki amaçlarla kullanıyoruz:</p>
                <ul>
                  <li>Hizmetimizi sağlamak ve sürdürmek</li>
                  <li>Hizmetimizdeki değişiklikler hakkında sizi bilgilendirmek</li>
                  <li>Müşteri desteği sağlamak</li>
                  <li>Hizmetimizi iyileştirmek için analiz veya değerli bilgiler toplamak</li>
                  <li>Hizmetimizin kullanımını izlemek</li>
                  <li>Teknik sorunları tespit etmek, önlemek ve gidermek</li>
                  <li>Ödemeleri işlemek ve abonelikleri yönetmek</li>
                </ul>

                <h2>4. Veri Güvenliği</h2>
                <p>
                  Kişisel verilerinizin yanlışlıkla kaybolmasını, kullanılmasını veya yetkisiz bir şekilde erişilmesini, değiştirilmesini veya ifşa edilmesini önlemek için uygun güvenlik önlemleri uyguladık. Veri iletimi ve depolamasını korumak için endüstri standardı şifreleme kullanıyoruz.
                </p>

                <h2>5. Veri Saklama</h2>
                <p>
                  Kişisel verilerinizi yalnızca topladığımız amaçları yerine getirmek için gerekli olduğu sürece saklayacağız, bu herhangi bir yasal, muhasebe veya raporlama gereksinimlerini karşılama amaçlarını içerir.
                </p>

                <h2>6. Haklarınız</h2>
                <p>Belirli koşullar altında, kişisel verilerinizle ilgili olarak veri koruma yasaları kapsamında haklarınız vardır:</p>
                <ul>
                  <li><strong>Erişim hakkı:</strong> Kişisel verilerinize erişim talep etme</li>
                  <li><strong>Düzeltme hakkı:</strong> Yanlış verilerin düzeltilmesini talep etme</li>
                  <li><strong>Silme hakkı:</strong> Kişisel verilerinizin silinmesini talep etme</li>
                  <li><strong>İşlemeyi kısıtlama hakkı:</strong> İşlemenin kısıtlanmasını talep etme</li>
                  <li><strong>Veri taşınabilirliği hakkı:</strong> Verilerinizin aktarılmasını talep etme</li>
                  <li><strong>İtiraz hakkı:</strong> Kişisel verilerinizin işlenmesine itiraz etme</li>
                </ul>

                <h2>7. Çerezler</h2>
                <p>
                  Hizmetimizde etkinliği izlemek ve belirli bilgileri tutmak için çerezler ve benzer izleme teknolojileri kullanıyoruz. Tarayıcınızı tüm çerezleri reddetmesi veya bir çerez gönderildiğinde belirtmesi için ayarlayabilirsiniz.
                </p>

                <h2>8. Üçüncü Taraf Hizmetleri</h2>
                <p>
                  Hizmetimizin kullanımını izlemek ve analiz etmek, ödemeleri işlemek ve diğer hizmetleri sağlamak için üçüncü taraf hizmet sağlayıcıları kullanabiliriz:
                </p>
                <ul>
                  <li><strong>Ödeme İşlemcileri:</strong> Stripe, Iyzico</li>
                  <li><strong>Analitik:</strong> Google Analytics</li>
                  <li><strong>Bulut Hizmetleri:</strong> Barındırma ve veri depolama için</li>
                </ul>

                <h2>9. Çocukların Gizliliği</h2>
                <p>
                  Hizmetimiz 18 yaşın altındaki hiç kimseye hitap etmez. 18 yaşın altındaki hiç kimseden bilerek kişisel tanımlanabilir bilgi toplamıyoruz.
                </p>

                <h2>10. Bu Politikadaki Değişiklikler</h2>
                <p>
                  Gizlilik Politikamızı zaman zaman güncelleyebiliriz. Yeni Gizlilik Politikasını bu sayfada yayınlayarak ve "Son güncelleme" tarihini güncelleyerek herhangi bir değişiklik hakkında sizi bilgilendireceğiz.
                </p>

                <h2>11. Bize Ulaşın</h2>
                <p>
                  Bu Gizlilik Politikası hakkında sorularınız varsa, lütfen bizimle iletişime geçin:
                </p>
                <p>
                  <strong>E-posta:</strong> privacy@hummytummy.com<br />
                  <strong>Web sitesi:</strong> https://hummytummy.com
                </p>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8 mt-12">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-gray-400">
            © {new Date().getFullYear()} HummyTummy. {isEnglish ? 'All rights reserved.' : 'Tüm hakları saklıdır.'}
          </p>
          <div className="flex justify-center gap-6 mt-4">
            <Link to="/privacy" className="text-primary-400 hover:text-primary-300 transition-colors">
              {isEnglish ? 'Privacy Policy' : 'Gizlilik Politikası'}
            </Link>
            <Link to="/terms" className="text-gray-400 hover:text-white transition-colors">
              {isEnglish ? 'Terms of Service' : 'Hizmet Şartları'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PrivacyPolicyPage;
