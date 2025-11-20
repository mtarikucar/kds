import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe, StripeElementsOptions } from '@stripe/stripe-js';
import { toast } from 'react-hot-toast';
import {
  useCreateCustomerPaymentIntent,
  useConfirmCustomerPayment,
  usePaymentStatus,
  PaymentProvider,
} from '../../api/customerPaymentsApi';
import { PaymentForm } from '../../components/qr-menu/PaymentForm';
import { IyzicoPayment } from '../../components/qr-menu/IyzicoPayment';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

export function PaymentPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const orderId = searchParams.get('orderId');
  const sessionId = localStorage.getItem(`customerSession_${tenantId}`);

  const [selectedProvider, setSelectedProvider] = useState<PaymentProvider>(PaymentProvider.STRIPE);
  const [tipAmount, setTipAmount] = useState(0);
  const [paymentIntent, setPaymentIntent] = useState<any>(null);
  const [stripePromise, setStripePromise] = useState<any>(null);

  const createIntent = useCreateCustomerPaymentIntent();
  const confirmPayment = useConfirmCustomerPayment();
  const { data: paymentStatus } = usePaymentStatus(orderId!, sessionId!);

  // Check if already paid
  useEffect(() => {
    if (paymentStatus?.isPaid) {
      toast.success('Order is already paid!');
      navigate(`/qr-menu/${tenantId}/orders`);
    }
  }, [paymentStatus, navigate, tenantId]);

  // Initialize payment
  const handleInitiatePayment = async () => {
    if (!orderId || !sessionId) {
      toast.error('Invalid order or session');
      return;
    }

    try {
      const returnUrl = `${window.location.origin}/qr-menu/${tenantId}/payment/callback`;
      const cancelUrl = `${window.location.origin}/qr-menu/${tenantId}/orders`;

      const intent = await createIntent.mutateAsync({
        orderId,
        sessionId,
        provider: selectedProvider,
        tipAmount,
        returnUrl,
        cancelUrl,
      });

      setPaymentIntent(intent);

      // Initialize Stripe if provider is Stripe
      if (selectedProvider === PaymentProvider.STRIPE && intent.publishableKey) {
        const stripe = await loadStripe(intent.publishableKey);
        setStripePromise(stripe);
      }

      toast.success('Payment initiated');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to initiate payment');
    }
  };

  const handleConfirmStripePayment = async (paymentMethodId: string) => {
    try {
      const result = await confirmPayment.mutateAsync({
        paymentIntentId: paymentIntent.paymentIntentId,
        paymentMethodId,
      });

      if (result.success) {
        toast.success('Payment successful!');
        navigate(`/qr-menu/${tenantId}/orders`);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Payment confirmation failed');
    }
  };

  const handleIyzicoCallback = async (token: string) => {
    try {
      const result = await confirmPayment.mutateAsync({
        paymentIntentId: token,
      });

      if (result.success) {
        toast.success('Payment successful!');
        navigate(`/qr-menu/${tenantId}/orders`);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Payment verification failed');
    }
  };

  // Tip presets
  const tipPresets = [0, 5, 10, 15, 20];

  if (!orderId || !sessionId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900">Invalid Payment Link</h2>
          <p className="mt-2 text-gray-600">Please return to your order and try again.</p>
          <button
            onClick={() => navigate(`/qr-menu/${tenantId}/orders`)}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Orders
          </button>
        </div>
      </div>
    );
  }

  // Show payment form after intent is created
  if (paymentIntent) {
    if (selectedProvider === PaymentProvider.STRIPE) {
      const options: StripeElementsOptions = {
        clientSecret: paymentIntent.clientSecret,
        appearance: {
          theme: 'stripe',
        },
      };

      return (
        <div className="min-h-screen bg-gray-50 py-8">
          <div className="max-w-2xl mx-auto px-4">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Complete Payment</h2>

              <div className="mb-6">
                <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
                  <span className="text-gray-600">Total Amount:</span>
                  <span className="text-2xl font-bold text-gray-900">
                    ${paymentIntent.amount.toFixed(2)}
                  </span>
                </div>
              </div>

              {stripePromise && (
                <Elements stripe={stripePromise} options={options}>
                  <PaymentForm
                    clientSecret={paymentIntent.clientSecret}
                    onSuccess={handleConfirmStripePayment}
                    onCancel={() => navigate(`/qr-menu/${tenantId}/orders`)}
                  />
                </Elements>
              )}
            </div>
          </div>
        </div>
      );
    } else if (selectedProvider === PaymentProvider.IYZICO) {
      return (
        <IyzicoPayment
          checkoutFormContent={paymentIntent.checkoutFormContent}
          onCallback={handleIyzicoCallback}
          onCancel={() => navigate(`/qr-menu/${tenantId}/orders`)}
        />
      );
    }
  }

  // Initial payment setup screen
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Payment</h2>
            <button
              onClick={() => navigate(`/qr-menu/${tenantId}/orders`)}
              className="text-gray-500 hover:text-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Order Summary */}
          {paymentStatus && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">Order Number:</span>
                <span className="font-semibold">{paymentStatus.orderNumber}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Order Amount:</span>
                <span className="text-xl font-bold text-gray-900">
                  ${paymentStatus.amount.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Tip Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Add a tip (optional)
            </label>
            <div className="flex gap-2 mb-3">
              {tipPresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setTipAmount(preset)}
                  className={`flex-1 py-2 px-4 rounded-lg border-2 transition-colors ${
                    tipAmount === preset
                      ? 'border-blue-600 bg-blue-50 text-blue-600'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  ${preset}
                </button>
              ))}
            </div>
            <input
              type="number"
              value={tipAmount}
              onChange={(e) => setTipAmount(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Custom tip amount"
              min="0"
              step="0.01"
            />
          </div>

          {/* Payment Provider Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Select Payment Method
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setSelectedProvider(PaymentProvider.STRIPE)}
                className={`p-4 rounded-lg border-2 transition-colors ${
                  selectedProvider === PaymentProvider.STRIPE
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-center">
                  <div className="text-lg font-semibold">Credit Card</div>
                  <div className="text-sm text-gray-500">Stripe</div>
                </div>
              </button>

              <button
                onClick={() => setSelectedProvider(PaymentProvider.IYZICO)}
                className={`p-4 rounded-lg border-2 transition-colors ${
                  selectedProvider === PaymentProvider.IYZICO
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-center">
                  <div className="text-lg font-semibold">Turkish Banks</div>
                  <div className="text-sm text-gray-500">Iyzico</div>
                </div>
              </button>
            </div>
          </div>

          {/* Total */}
          {paymentStatus && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-700">Order Total:</span>
                <span className="font-semibold">${paymentStatus.amount.toFixed(2)}</span>
              </div>
              {tipAmount > 0 && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-700">Tip:</span>
                  <span className="font-semibold">${tipAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 border-t border-blue-300">
                <span className="text-lg font-bold text-gray-900">Grand Total:</span>
                <span className="text-2xl font-bold text-blue-600">
                  ${(paymentStatus.amount + tipAmount).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Proceed Button */}
          <button
            onClick={handleInitiatePayment}
            disabled={createIntent.isPending}
            className="w-full py-4 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {createIntent.isPending ? (
              <>
                <LoadingSpinner size="sm" />
                Processing...
              </>
            ) : (
              'Proceed to Payment'
            )}
          </button>

          <p className="mt-4 text-sm text-gray-500 text-center">
            Your payment is secure and encrypted
          </p>
        </div>
      </div>
    </div>
  );
}
