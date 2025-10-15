# KDS System - API Endpoints Guide

**Base URL:** http://38.242.233.166:3000
**Frontend URL:** http://38.242.233.166

---

## ✅ Working Endpoints (Verified)

### Authentication

#### Register New User/Restaurant
```bash
POST http://38.242.233.166:3000/api/auth/register
Content-Type: application/json

{
  "email": "your@email.com",
  "password": "yourpassword",
  "firstName": "Your",
  "lastName": "Name",
  "restaurantName": "Your Restaurant Name"  # Creates new tenant
}

# OR join existing tenant:
{
  "email": "your@email.com",
  "password": "yourpassword",
  "firstName": "Your",
  "lastName": "Name",
  "tenantId": "existing-tenant-uuid"  # Join existing restaurant
}
```

**Response:** HTTP 201
```json
{
  "accessToken": "jwt-token...",
  "refreshToken": "refresh-token...",
  "user": {
    "id": "uuid",
    "email": "your@email.com",
    "firstName": "Your",
    "lastName": "Name",
    "role": "ADMIN",
    "tenantId": "tenant-uuid"
  }
}
```

#### Login
```bash
POST http://38.242.233.166:3000/api/auth/login
Content-Type: application/json

{
  "email": "admin@restaurant.com",
  "password": "password123"
}
```

**Response:** HTTP 201 (same structure as register)

#### Get Profile
```bash
GET http://38.242.233.166:3000/api/auth/profile
Authorization: Bearer {accessToken}
```

#### Refresh Token
```bash
POST http://38.242.233.166:3000/api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "your-refresh-token"
}
```

---

### Menu Management

#### Categories
```bash
# Get all categories
GET http://38.242.233.166:3000/api/menu/categories
Authorization: Bearer {accessToken}

# Create category
POST http://38.242.233.166:3000/api/menu/categories
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "name": "Appetizers",
  "description": "Starter dishes",
  "displayOrder": 1
}

# Update category
PATCH http://38.242.233.166:3000/api/menu/categories/{id}

# Delete category
DELETE http://38.242.233.166:3000/api/menu/categories/{id}
```

#### Products
```bash
# Get all products
GET http://38.242.233.166:3000/api/menu/products
Authorization: Bearer {accessToken}

# Create product
POST http://38.242.233.166:3000/api/menu/products
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "name": "Caesar Salad",
  "description": "Fresh romaine lettuce",
  "price": 8.99,
  "categoryId": "category-uuid",
  "isAvailable": true,
  "stockTracked": true,
  "currentStock": 50
}

# Update product
PATCH http://38.242.233.166:3000/api/menu/products/{id}

# Delete product
DELETE http://38.242.233.166:3000/api/menu/products/{id}

# Update stock
PATCH http://38.242.233.166:3000/api/menu/products/{id}/stock
Content-Type: application/json

{
  "currentStock": 45
}
```

---

### Table Management

```bash
# Get all tables
GET http://38.242.233.166:3000/api/tables
Authorization: Bearer {accessToken}

# Create table
POST http://38.242.233.166:3000/api/tables
Content-Type: application/json

{
  "number": "10",
  "capacity": 4,
  "section": "Main Hall",
  "status": "AVAILABLE"
}

# Update table status
PATCH http://38.242.233.166:3000/api/tables/{id}/status
Content-Type: application/json

{
  "status": "OCCUPIED"
}
```

---

### Order Management

```bash
# Get all orders
GET http://38.242.233.166:3000/api/orders
Authorization: Bearer {accessToken}

# Create order
POST http://38.242.233.166:3000/api/orders
Content-Type: application/json

{
  "tableId": "table-uuid",
  "type": "DINE_IN",
  "items": [
    {
      "productId": "product-uuid",
      "quantity": 2,
      "notes": "No onions"
    }
  ]
}

# Update order status
PATCH http://38.242.233.166:3000/api/orders/{id}/status
Content-Type: application/json

{
  "status": "PREPARING"
}
```

---

### Kitchen Display System (KDS)

```bash
# Get kitchen orders
GET http://38.242.233.166:3000/api/kds/orders
Authorization: Bearer {accessToken}

# Update order status
PATCH http://38.242.233.166:3000/api/kds/orders/{id}/status
Content-Type: application/json

{
  "status": "PREPARING"  # or "READY"
}

# Update item status
PATCH http://38.242.233.166:3000/api/kds/order-items/{id}/status
Content-Type: application/json

{
  "status": "PREPARING"
}
```

---

### Payments

```bash
# Create payment
POST http://38.242.233.166:3000/api/orders/{orderId}/payments
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "amount": 50.00,
  "method": "CASH",  # or "CARD", "ONLINE"
  "notes": "Table 5 payment"
}

# Get order payments
GET http://38.242.233.166:3000/api/orders/{orderId}/payments
Authorization: Bearer {accessToken}
```

---

### Reports

```bash
# Sales report
GET http://38.242.233.166:3000/api/reports/sales?startDate=2025-10-01&endDate=2025-10-14
Authorization: Bearer {accessToken}

# Top products
GET http://38.242.233.166:3000/api/reports/top-products?limit=10
Authorization: Bearer {accessToken}

# Payment summary
GET http://38.242.233.166:3000/api/reports/payments?startDate=2025-10-01&endDate=2025-10-14
Authorization: Bearer {accessToken}

# Orders by hour
GET http://38.242.233.166:3000/api/reports/orders-by-hour
Authorization: Bearer {accessToken}
```

---

### Stock Management

```bash
# Create stock movement
POST http://38.242.233.166:3000/api/stock/movements
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "productId": "product-uuid",
  "quantity": 20,
  "type": "IN",  # or "OUT"
  "reason": "Purchase"
}

# Get stock movements
GET http://38.242.233.166:3000/api/stock/movements
Authorization: Bearer {accessToken}

# Get low stock alerts
GET http://38.242.233.166:3000/api/stock/alerts
Authorization: Bearer {accessToken}
```

---

### QR Menu (Public - No Auth Required)

```bash
# Get public menu for a restaurant
GET http://38.242.233.166:3000/api/qr-menu/{tenantId}
```

---

## 🔒 Authentication

All endpoints except `/api/auth/login`, `/api/auth/register`, and `/api/qr-menu/*` require authentication.

### How to Authenticate:

1. **Login or Register** to get access token
2. **Add Header** to all requests:
   ```
   Authorization: Bearer {your-access-token}
   ```

### Token Refresh:
- Access tokens expire in 7 days
- Refresh tokens expire in 30 days
- Use `/api/auth/refresh` endpoint to get new tokens

---

## 📚 API Documentation (Swagger)

Interactive API documentation available at:
**http://38.242.233.166:3000/api/docs**

This provides:
- Complete endpoint documentation
- Request/response schemas
- Try it out functionality
- Authentication testing

---

## ⚠️ Common Issues & Solutions

### Issue: "Cannot POST /auth/register"
**Solution:** Use `/api/auth/register` (with `/api` prefix)

### Issue: 401 Unauthorized
**Solution:** Include `Authorization: Bearer {token}` header

### Issue: "Either restaurantName or tenantId must be provided"
**Solution:** When registering, include either:
- `restaurantName` (creates new restaurant)
- `tenantId` (joins existing restaurant)

### Issue: CORS errors from browser
**Solution:** CORS is configured for `http://38.242.233.166`

---

## 🧪 Test With cURL

```bash
# 1. Register
TOKEN=$(curl -s -X POST http://38.242.233.166:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123","firstName":"Test","lastName":"User","restaurantName":"Test Restaurant"}' \
  | jq -r .accessToken)

# 2. Use token for requests
curl -X GET http://38.242.233.166:3000/api/menu/products \
  -H "Authorization: Bearer $TOKEN"
```

---

## 📝 Notes

- All dates should be in ISO 8601 format: `2025-10-14T12:00:00Z`
- All prices are in decimal format: `19.99`
- UUIDs are used for all ID fields
- WebSocket connections available at same base URL for real-time updates
