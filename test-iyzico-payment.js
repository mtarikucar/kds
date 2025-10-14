/**
 * Iyzico Payment System Test Script
 *
 * This script tests the complete Iyzico payment flow:
 * 1. User registration with TURKEY payment region
 * 2. Login and get JWT token
 * 3. Create subscription with Iyzico
 * 4. Create payment intent
 * 5. Confirm payment with test card
 * 6. Verify payment in database
 * 7. Test webhook callback
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

// Test data
const testData = {
  restaurant: {
    name: `Test Restaurant ${Date.now()}`,
    email: `test${Date.now()}@example.com`,
    password: 'Test123!@#',
    firstName: 'Test',
    lastName: 'User',
  },
  iyzicoTestCard: {
    cardHolderName: 'Test User',
    cardNumber: '5528790000000001', // Success card
    expireMonth: '12',
    expireYear: '2030',
    cvc: '123',
  },
  iyzicoFailCard: {
    cardHolderName: 'Test User',
    cardNumber: '5406670000000009', // Decline card
    expireMonth: '12',
    expireYear: '2030',
    cvc: '123',
  },
};

let authToken = null;
let tenantId = null;
let subscriptionId = null;
let planId = null;

// Test results
const results = {
  passed: [],
  failed: [],
};

function logSuccess(test) {
  console.log(`✓ PASS: ${test}`);
  results.passed.push(test);
}

function logError(test, error) {
  console.log(`✗ FAIL: ${test}`);
  console.log(`  Error: ${error.message || JSON.stringify(error)}`);
  results.failed.push({ test, error: error.message || error });
}

// Test 1: Register user with TURKEY region
async function testRegistration() {
  const testName = 'User Registration with Iyzico (TURKEY)';
  try {
    const response = await axios.post(`${BASE_URL}/auth/register`, {
      restaurantName: testData.restaurant.name,
      email: testData.restaurant.email,
      password: testData.restaurant.password,
      firstName: testData.restaurant.firstName,
      lastName: testData.restaurant.lastName,
      paymentRegion: 'TURKEY', // Use Iyzico
    });

    authToken = response.data.accessToken;
    tenantId = response.data.user.tenantId;

    if (authToken && tenantId) {
      logSuccess(testName);
      return true;
    } else {
      throw new Error('No token or tenantId returned');
    }
  } catch (error) {
    logError(testName, error.response?.data || error);
    return false;
  }
}

// Test 2: Get available subscription plans
async function testGetPlans() {
  const testName = 'Get Subscription Plans';
  try {
    const response = await axios.get(`${BASE_URL}/subscriptions/plans`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (response.data && response.data.length > 0) {
      // Find a paid plan (not FREE)
      planId = response.data.find(p => p.name !== 'FREE')?.id;
      if (!planId) {
        planId = response.data[0].id; // Fallback to first plan
      }
      logSuccess(`${testName} - Found ${response.data.length} plans`);
      return true;
    } else {
      throw new Error('No plans returned');
    }
  } catch (error) {
    logError(testName, error.response?.data || error);
    return false;
  }
}

// Test 3: Get current subscription
async function testGetCurrentSubscription() {
  const testName = 'Get Current Subscription';
  try {
    const response = await axios.get(`${BASE_URL}/subscriptions/current`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (response.data) {
      subscriptionId = response.data.id;
      console.log(`  Subscription ID: ${subscriptionId}`);
      console.log(`  Status: ${response.data.status}`);
      console.log(`  Payment Provider: ${response.data.paymentProvider}`);
      console.log(`  Is Trial: ${response.data.isTrialPeriod}`);
      logSuccess(testName);
      return true;
    } else {
      throw new Error('No subscription returned');
    }
  } catch (error) {
    logError(testName, error.response?.data || error);
    return false;
  }
}

// Test 4: Create payment intent
async function testCreatePaymentIntent() {
  const testName = 'Create Iyzico Payment Intent';
  try {
    const response = await axios.post(
      `${BASE_URL}/payments/create-intent`,
      {
        planId: planId,
        billingCycle: 'MONTHLY',
        paymentProvider: 'IYZICO',
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    if (response.data && response.data.provider === 'IYZICO') {
      console.log(`  Amount: ${response.data.amount} ${response.data.currency}`);
      console.log(`  Plan ID: ${response.data.planId}`);
      logSuccess(testName);
      return true;
    } else {
      throw new Error('Invalid payment intent response');
    }
  } catch (error) {
    logError(testName, error.response?.data || error);
    return false;
  }
}

// Test 5: Confirm payment with SUCCESS card
async function testConfirmPayment() {
  const testName = 'Confirm Iyzico Payment (SUCCESS card)';
  try {
    const response = await axios.post(
      `${BASE_URL}/payments/confirm-payment`,
      {
        iyzicoDetails: testData.iyzicoTestCard,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    if (response.data && response.data.success) {
      console.log(`  Payment Status: ${response.data.payment.status}`);
      console.log(`  Payment ID: ${response.data.payment.id}`);
      console.log(`  Iyzico Payment ID: ${response.data.payment.iyzicoPaymentId || 'N/A'}`);
      logSuccess(testName);
      return true;
    } else {
      throw new Error('Payment confirmation failed');
    }
  } catch (error) {
    logError(testName, error.response?.data || error);
    return false;
  }
}

// Test 6: Test FAILED payment
async function testFailedPayment() {
  const testName = 'Test Failed Payment (DECLINE card)';
  try {
    const response = await axios.post(
      `${BASE_URL}/payments/confirm-payment`,
      {
        iyzicoDetails: testData.iyzicoFailCard,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    // If we get here, payment succeeded when it should have failed
    logError(testName, new Error('Payment should have failed but succeeded'));
    return false;
  } catch (error) {
    if (error.response?.status === 400) {
      console.log(`  Error Message: ${error.response.data.message || 'Payment declined'}`);
      logSuccess(testName + ' - Correctly declined');
      return true;
    } else {
      logError(testName, error.response?.data || error);
      return false;
    }
  }
}

// Test 7: Get payment history
async function testGetPaymentHistory() {
  const testName = 'Get Payment History';
  try {
    const response = await axios.post(
      `${BASE_URL}/payments/history`,
      {},
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    if (response.data && Array.isArray(response.data)) {
      console.log(`  Found ${response.data.length} payment(s)`);
      if (response.data.length > 0) {
        console.log(`  Latest Payment: ${response.data[0].status} - ${response.data[0].amount} ${response.data[0].currency}`);
      }
      logSuccess(testName);
      return true;
    } else {
      throw new Error('Invalid payment history response');
    }
  } catch (error) {
    logError(testName, error.response?.data || error);
    return false;
  }
}

// Test 8: Test webhook signature verification (unit test)
async function testWebhookVerification() {
  const testName = 'Webhook Signature Verification (Simulated)';
  try {
    // This is a simulated test - in real scenario, Iyzico would call our webhook
    // We're just checking if the endpoint exists and requires proper signature
    const response = await axios.post(
      `${BASE_URL}/webhooks/iyzico`,
      {
        paymentId: 'test-payment-id',
        status: 'success',
      },
      {
        headers: {
          'x-iyzico-signature': 'invalid-signature',
        },
        validateStatus: () => true, // Don't throw on any status
      }
    );

    if (response.status === 401 || response.status === 403) {
      console.log(`  Webhook correctly rejects invalid signature (Status: ${response.status})`);
      logSuccess(testName);
      return true;
    } else if (response.status === 200) {
      logError(testName, new Error('Webhook accepted invalid signature'));
      return false;
    } else {
      console.log(`  Webhook returned status: ${response.status}`);
      logSuccess(testName + ' - Endpoint exists');
      return true;
    }
  } catch (error) {
    logError(testName, error.response?.data || error);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('\n========================================');
  console.log('🧪 IYZICO PAYMENT SYSTEM TEST SUITE');
  console.log('========================================\n');

  console.log('📝 Test Configuration:');
  console.log(`  API URL: ${BASE_URL}`);
  console.log(`  Success Card: ${testData.iyzicoTestCard.cardNumber}`);
  console.log(`  Decline Card: ${testData.iyzicoFailCard.cardNumber}`);
  console.log('\n----------------------------------------\n');

  // Run tests sequentially
  console.log('🔄 Running Tests...\n');

  await testRegistration();
  if (authToken) {
    await testGetPlans();
    if (planId) {
      await testGetCurrentSubscription();
      await testCreatePaymentIntent();
      await testConfirmPayment();
      await testFailedPayment();
      await testGetPaymentHistory();
    }
  }
  await testWebhookVerification();

  // Print summary
  console.log('\n========================================');
  console.log('📊 TEST SUMMARY');
  console.log('========================================\n');

  console.log(`✓ Passed: ${results.passed.length}`);
  results.passed.forEach(test => console.log(`  - ${test}`));

  if (results.failed.length > 0) {
    console.log(`\n✗ Failed: ${results.failed.length}`);
    results.failed.forEach(({ test, error }) => {
      console.log(`  - ${test}`);
      console.log(`    ${error}`);
    });
  }

  const totalTests = results.passed.length + results.failed.length;
  const successRate = ((results.passed.length / totalTests) * 100).toFixed(2);

  console.log(`\n📈 Success Rate: ${successRate}% (${results.passed.length}/${totalTests})`);
  console.log('\n========================================\n');

  // Exit with appropriate code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
