import { useEffect, useRef } from 'react';

interface IyzicoPaymentProps {
  checkoutFormContent: string;
  onCallback: (token: string) => void;
  onCancel: () => void;
}

export function IyzicoPayment({ checkoutFormContent, onCallback, onCancel }: IyzicoPaymentProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current && checkoutFormContent) {
      // Inject Iyzico checkout form
      containerRef.current.innerHTML = checkoutFormContent;

      // Listen for Iyzico callback
      const handleMessage = (event: MessageEvent) => {
        if (event.data && event.data.token) {
          onCallback(event.data.token);
        }
      };

      window.addEventListener('message', handleMessage);

      return () => {
        window.removeEventListener('message', handleMessage);
      };
    }
  }, [checkoutFormContent, onCallback]);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Complete Payment</h2>
            <button
              onClick={onCancel}
              className="text-gray-500 hover:text-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={containerRef} className="iyzico-checkout-form">
            {/* Iyzico checkout form will be injected here */}
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            <span>Secured by Iyzico</span>
          </div>
        </div>
      </div>
    </div>
  );
}
