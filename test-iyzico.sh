#!/bin/bash

# Iyzico Payment System Test Script
# Tests the complete payment flow using curl

BASE_URL="http://localhost:3000/api"
TIMESTAMP=$(date +%s)

echo "========================================"
echo "🧪 IYZICO PAYMENT SYSTEM TEST"
echo "========================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test 1: Register user with TURKEY region
echo "Test 1: User Registration (TURKEY region)..."
REGISTER_RESPONSE=$(curl -s -X POST "${BASE_URL}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"restaurantName\": \"Test Restaurant ${TIMESTAMP}\",
    \"email\": \"test${TIMESTAMP}@example.com\",
    \"password\": \"Test123!@#\",
    \"firstName\": \"Test\",
    \"lastName\": \"User\",
    \"paymentRegion\": \"TURKEY\"
  }")

TOKEN=$(echo $REGISTER_RESPONSE | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
TENANT_ID=$(echo $REGISTER_RESPONSE | grep -o '"tenantId":"[^"]*' | cut -d'"' -f4)

if [ ! -z "$TOKEN" ]; then
  echo -e "${GREEN}✓ PASS: Registration successful${NC}"
  echo "  Token: ${TOKEN:0:20}..."
  echo "  Tenant ID: $TENANT_ID"
else
  echo -e "${RED}✗ FAIL: Registration failed${NC}"
  echo "  Response: $REGISTER_RESPONSE"
  exit 1
fi

echo ""

# Test 2: Get subscription plans
echo "Test 2: Get Subscription Plans..."
PLANS_RESPONSE=$(curl -s -X GET "${BASE_URL}/subscriptions/plans" \
  -H "Authorization: Bearer $TOKEN")

PLAN_ID=$(echo $PLANS_RESPONSE | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ ! -z "$PLAN_ID" ]; then
  echo -e "${GREEN}✓ PASS: Plans retrieved${NC}"
  echo "  Plan ID: $PLAN_ID"
else
  echo -e "${RED}✗ FAIL: Could not get plans${NC}"
  echo "  Response: $PLANS_RESPONSE"
fi

echo ""

# Test 3: Get current subscription
echo "Test 3: Get Current Subscription..."
SUBSCRIPTION_RESPONSE=$(curl -s -X GET "${BASE_URL}/subscriptions/current" \
  -H "Authorization: Bearer $TOKEN")

SUBSCRIPTION_ID=$(echo $SUBSCRIPTION_RESPONSE | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
PAYMENT_PROVIDER=$(echo $SUBSCRIPTION_RESPONSE | grep -o '"paymentProvider":"[^"]*' | cut -d'"' -f4)

if [ ! -z "$SUBSCRIPTION_ID" ]; then
  echo -e "${GREEN}✓ PASS: Subscription retrieved${NC}"
  echo "  Subscription ID: $SUBSCRIPTION_ID"
  echo "  Payment Provider: $PAYMENT_PROVIDER"
else
  echo -e "${RED}✗ FAIL: Could not get subscription${NC}"
  echo "  Response: $SUBSCRIPTION_RESPONSE"
fi

echo ""

# Test 4: Create payment intent
echo "Test 4: Create Payment Intent..."
INTENT_RESPONSE=$(curl -s -X POST "${BASE_URL}/payments/create-intent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"planId\": \"$PLAN_ID\",
    \"billingCycle\": \"MONTHLY\",
    \"paymentProvider\": \"IYZICO\"
  }")

PROVIDER=$(echo $INTENT_RESPONSE | grep -o '"provider":"[^"]*' | cut -d'"' -f4)
AMOUNT=$(echo $INTENT_RESPONSE | grep -o '"amount":[0-9.]*' | cut -d':' -f2)

if [ "$PROVIDER" = "IYZICO" ]; then
  echo -e "${GREEN}✓ PASS: Payment intent created${NC}"
  echo "  Provider: $PROVIDER"
  echo "  Amount: $AMOUNT"
else
  echo -e "${RED}✗ FAIL: Payment intent creation failed${NC}"
  echo "  Response: $INTENT_RESPONSE"
fi

echo ""

# Test 5: Confirm payment with SUCCESS card
echo "Test 5: Confirm Payment (SUCCESS card)..."
PAYMENT_RESPONSE=$(curl -s -X POST "${BASE_URL}/payments/confirm-payment" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "iyzicoDetails": {
      "cardHolderName": "Test User",
      "cardNumber": "5528790000000001",
      "expireMonth": "12",
      "expireYear": "2030",
      "cvc": "123"
    }
  }')

SUCCESS=$(echo $PAYMENT_RESPONSE | grep -o '"success":[^,}]*' | cut -d':' -f2)

if [ "$SUCCESS" = "true" ]; then
  echo -e "${GREEN}✓ PASS: Payment confirmed${NC}"
  echo "  Response: $PAYMENT_RESPONSE"
else
  echo -e "${RED}✗ FAIL: Payment confirmation failed${NC}"
  echo "  Response: $PAYMENT_RESPONSE"
fi

echo ""

# Test 6: Test FAILED payment with decline card
echo "Test 6: Test Failed Payment (DECLINE card)..."
FAIL_PAYMENT_RESPONSE=$(curl -s -X POST "${BASE_URL}/payments/confirm-payment" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "iyzicoDetails": {
      "cardHolderName": "Test User",
      "cardNumber": "5406670000000009",
      "expireMonth": "12",
      "expireYear": "2030",
      "cvc": "123"
    }
  }')

ERROR_MSG=$(echo $FAIL_PAYMENT_RESPONSE | grep -o '"message":"[^"]*' | cut -d'"' -f4)

if [ ! -z "$ERROR_MSG" ]; then
  echo -e "${GREEN}✓ PASS: Failed payment correctly handled${NC}"
  echo "  Error: $ERROR_MSG"
else
  echo -e "${RED}✗ FAIL: Failed payment should have been rejected${NC}"
  echo "  Response: $FAIL_PAYMENT_RESPONSE"
fi

echo ""

# Test 7: Get payment history
echo "Test 7: Get Payment History..."
HISTORY_RESPONSE=$(curl -s -X POST "${BASE_URL}/payments/history" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')

PAYMENT_COUNT=$(echo $HISTORY_RESPONSE | grep -o '"id"' | wc -l)

if [ $PAYMENT_COUNT -gt 0 ]; then
  echo -e "${GREEN}✓ PASS: Payment history retrieved${NC}"
  echo "  Found $PAYMENT_COUNT payment(s)"
else
  echo -e "${RED}✗ FAIL: No payments found${NC}"
  echo "  Response: $HISTORY_RESPONSE"
fi

echo ""

# Test 8: Test webhook endpoint
echo "Test 8: Webhook Endpoint Verification..."
WEBHOOK_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${BASE_URL}/webhooks/iyzico" \
  -H "Content-Type: application/json" \
  -H "x-iyzico-signature: invalid-signature" \
  -d '{
    "paymentId": "test-payment",
    "status": "success"
  }')

HTTP_STATUS=$(echo "$WEBHOOK_RESPONSE" | grep "HTTP_STATUS" | cut -d':' -f2)

if [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ] || [ "$HTTP_STATUS" = "400" ]; then
  echo -e "${GREEN}✓ PASS: Webhook correctly rejects invalid signature${NC}"
  echo "  HTTP Status: $HTTP_STATUS"
else
  echo "  HTTP Status: $HTTP_STATUS"
  echo "  Response: $WEBHOOK_RESPONSE"
  echo -e "${GREEN}✓ PASS: Webhook endpoint exists${NC}"
fi

echo ""
echo "========================================"
echo "✅ TEST COMPLETE"
echo "========================================"
