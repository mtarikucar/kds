# Restaurant POS API Documentation

Complete API reference for the Restaurant POS backend.

**Base URL:** `http://localhost:3000/api`

**Interactive Documentation:** `http://localhost:3000/api/docs` (Swagger UI)

---

## Authentication

All endpoints (except those marked as **Public**) require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### POST /auth/register

Register a new user account.

**Request Body:**
```json
{
  "email": "user@restaurant.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "role": "WAITER",
  "tenantId": "uuid-of-tenant"
}
```

**Response:** `201 Created`
```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "email": "user@restaurant.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "WAITER",
    "tenantId": "uuid"
  }
}
```

### POST /auth/login

Login with email and password.

**Request Body:**
```json
{
  "email": "admin@restaurant.com",
  "password": "password123"
}
```

**Response:** `200 OK` (same as register)

### POST /auth/refresh

Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGc..."
}
```

**Response:** `200 OK` (new tokens)

### GET /auth/profile

Get current user profile.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@restaurant.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "WAITER",
  "tenantId": "uuid"
}
```

---

## Tenants

**Required Role:** ADMIN

### GET /tenants

Get all tenants.

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "My Restaurant",
    "subdomain": "my-restaurant",
    "plan": "PREMIUM",
    "status": "ACTIVE",
    "createdAt": "2024-01-01T00:00:00Z",
    "_count": {
      "users": 5,
      "products": 50,
      "orders": 100
    }
  }
]
```

### POST /tenants

Create a new tenant.

**Request Body:**
```json
{
  "name": "My Restaurant",
  "subdomain": "my-restaurant",
  "plan": "PREMIUM"
}
```

**Response:** `201 Created`

### PATCH /tenants/:id

Update tenant.

### DELETE /tenants/:id

Delete tenant.

---

## Users

**Required Role:** ADMIN, MANAGER

### GET /users

Get all users (filtered by tenant).

**Query Parameters:**
- `role` - Filter by role (ADMIN, MANAGER, WAITER, KITCHEN, COURIER)
- `status` - Filter by status (ACTIVE, INACTIVE)

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "email": "waiter@restaurant.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "WAITER",
    "status": "ACTIVE",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]
```

### POST /users

Create a new user.

**Request Body:**
```json
{
  "email": "newuser@restaurant.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Smith",
  "role": "WAITER"
}
```

### PATCH /users/:id

Update user.

### DELETE /users/:id

Delete user.

---

## Menu - Categories

**Required Role:** ADMIN, MANAGER (mutations)

### GET /categories

Get all categories.

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "Appetizers",
    "description": "Start your meal",
    "displayOrder": 1,
    "isActive": true,
    "_count": {
      "products": 5
    }
  }
]
```

### POST /categories

Create category.

**Request Body:**
```json
{
  "name": "Appetizers",
  "description": "Start your meal",
  "displayOrder": 1,
  "isActive": true
}
```

### PATCH /categories/:id

Update category.

### DELETE /categories/:id

Delete category (fails if products exist).

---

## Menu - Products

### GET /products

Get all products.

**Query Parameters:**
- `categoryId` - Filter by category
- `isAvailable` - Filter by availability

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "Caesar Salad",
    "description": "Fresh romaine lettuce",
    "price": "8.99",
    "image": null,
    "isAvailable": true,
    "stockTracked": true,
    "currentStock": 50,
    "category": {
      "id": "uuid",
      "name": "Appetizers"
    }
  }
]
```

### POST /products

Create product.

**Request Body:**
```json
{
  "name": "Caesar Salad",
  "description": "Fresh romaine lettuce",
  "price": 8.99,
  "categoryId": "uuid",
  "isAvailable": true,
  "stockTracked": true,
  "currentStock": 50
}
```

### PATCH /products/:id

Update product.

### DELETE /products/:id

Delete product.

### PATCH /products/:id/stock

Update product stock.

**Request Body:**
```json
{
  "currentStock": 25
}
```

---

## QR Menu (Public)

### GET /qr-menu/:tenantId

Get menu for QR code scanning (no authentication required).

**Response:** `200 OK`
```json
{
  "tenant": {
    "name": "My Restaurant"
  },
  "categories": [
    {
      "id": "uuid",
      "name": "Appetizers",
      "products": [
        {
          "id": "uuid",
          "name": "Caesar Salad",
          "description": "Fresh romaine",
          "price": "8.99"
        }
      ]
    }
  ]
}
```

---

## Tables

**Required Role:** ADMIN, MANAGER

### GET /tables

Get all tables.

**Query Parameters:**
- `status` - Filter by status (AVAILABLE, OCCUPIED, RESERVED)
- `section` - Filter by section

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "number": "1",
    "capacity": 4,
    "section": "Main Hall",
    "status": "AVAILABLE",
    "_count": {
      "orders": 0
    }
  }
]
```

### POST /tables

Create table.

**Request Body:**
```json
{
  "number": "1",
  "capacity": 4,
  "section": "Main Hall"
}
```

### PATCH /tables/:id/status

Update table status.

**Required Role:** ADMIN, MANAGER, WAITER

**Request Body:**
```json
{
  "status": "OCCUPIED"
}
```

### DELETE /tables/:id

Delete table (fails if active orders exist).

---

## Orders

**Required Role:** ADMIN, MANAGER, WAITER

### GET /orders

Get all orders.

**Query Parameters:**
- `status` - Filter by status (PENDING, PREPARING, READY, SERVED, PAID, CANCELLED)
- `type` - Filter by type (DINE_IN, TAKEAWAY, DELIVERY)
- `tableId` - Filter by table
- `startDate` - Filter by date range
- `endDate` - Filter by date range

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "orderNumber": "ORD-1704067200-ABC123",
    "type": "DINE_IN",
    "status": "PREPARING",
    "totalAmount": "25.99",
    "discount": "0.00",
    "finalAmount": "25.99",
    "table": {
      "number": "5"
    },
    "items": [
      {
        "id": "uuid",
        "quantity": 1,
        "unitPrice": "8.99",
        "subtotal": "8.99",
        "product": {
          "name": "Caesar Salad"
        }
      }
    ],
    "createdAt": "2024-01-01T12:00:00Z"
  }
]
```

### POST /orders

Create new order.

**Request Body:**
```json
{
  "type": "DINE_IN",
  "tableId": "uuid",
  "customerName": "John Doe",
  "notes": "No onions",
  "discount": 0,
  "items": [
    {
      "productId": "uuid",
      "quantity": 2,
      "unitPrice": 8.99,
      "notes": "Extra dressing"
    }
  ]
}
```

**Response:** `201 Created`

### PATCH /orders/:id/status

Update order status.

**Request Body:**
```json
{
  "status": "PREPARING"
}
```

### DELETE /orders/:id

Cancel order.

---

## Payments

**Required Role:** ADMIN, MANAGER, WAITER

### POST /payments

Create payment for an order.

**Request Body:**
```json
{
  "orderId": "uuid",
  "amount": 25.99,
  "method": "CARD",
  "notes": "Visa ending in 1234"
}
```

**Response:** `201 Created`

Auto-updates order status to PAID when payment completes.
Auto-deducts stock for tracked products.
Auto-updates table status to AVAILABLE.

### GET /payments

Get all payments for current tenant.

**Query Parameters:**
- `orderId` - Filter by order
- `status` - Filter by status (PENDING, COMPLETED, FAILED, REFUNDED)
- `method` - Filter by method (CASH, CARD, DIGITAL)

---

## Kitchen Display System (KDS)

**Required Role:** ADMIN, MANAGER, KITCHEN

### GET /kds/orders

Get orders for kitchen display (only PENDING, PREPARING, READY).

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "orderNumber": "ORD-123",
    "status": "PENDING",
    "table": { "number": "5" },
    "items": [
      {
        "id": "uuid",
        "quantity": 2,
        "status": "PENDING",
        "product": {
          "name": "Caesar Salad"
        },
        "notes": "Extra dressing"
      }
    ],
    "createdAt": "2024-01-01T12:00:00Z"
  }
]
```

### PATCH /kds/orders/:id/status

Update order status (emits WebSocket event).

**Request Body:**
```json
{
  "status": "PREPARING"
}
```

### PATCH /kds/order-items/:id/status

Update individual item status.

**Request Body:**
```json
{
  "status": "READY"
}
```

---

## WebSocket Events (Kitchen Display)

**Namespace:** `/kds`

**Authentication:** JWT token in handshake query: `?token=<jwt>`

### Client → Server

**Join room:**
```javascript
socket.emit('join-kitchen', { tenantId: 'uuid' });
```

### Server → Client

**New order:**
```javascript
socket.on('order:new', (data) => {
  // { orderId, orderNumber, items, table }
});
```

**Order status changed:**
```javascript
socket.on('order:status-changed', (data) => {
  // { orderId, status }
});
```

**Order item status changed:**
```javascript
socket.on('order:item-status-changed', (data) => {
  // { orderItemId, status }
});
```

---

## Stock Management

**Required Role:** ADMIN, MANAGER

### GET /stock/movements

Get stock movements.

**Query Parameters:**
- `productId` - Filter by product
- `type` - Filter by type (IN, OUT, ADJUSTMENT)
- `startDate` - Date range
- `endDate` - Date range

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "type": "OUT",
    "quantity": -5,
    "reason": "Sale",
    "product": {
      "name": "Caesar Salad"
    },
    "user": {
      "firstName": "John",
      "lastName": "Doe"
    },
    "createdAt": "2024-01-01T12:00:00Z"
  }
]
```

### POST /stock/movements

Create stock movement.

**Request Body:**
```json
{
  "productId": "uuid",
  "type": "IN",
  "quantity": 50,
  "reason": "Restock",
  "notes": "Weekly delivery"
}
```

Types:
- **IN**: Adds to stock
- **OUT**: Removes from stock
- **ADJUSTMENT**: Sets exact stock level

### GET /stock/alerts

Get low stock alerts (currentStock < threshold).

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "name": "Caesar Salad",
    "currentStock": 5,
    "category": {
      "name": "Appetizers"
    }
  }
]
```

---

## Reports

**Required Role:** ADMIN, MANAGER

### GET /reports/sales

Get sales summary.

**Query Parameters:**
- `startDate` - Start date (ISO 8601)
- `endDate` - End date (ISO 8601)

**Response:** `200 OK`
```json
{
  "totalSales": "5429.50",
  "orderCount": 150,
  "averageOrderValue": "36.20",
  "paymentMethodBreakdown": {
    "CASH": "2150.00",
    "CARD": "2879.50",
    "DIGITAL": "400.00"
  }
}
```

### GET /reports/top-products

Get top-selling products.

**Query Parameters:**
- `startDate`
- `endDate`
- `limit` - Number of products (default: 10)

**Response:** `200 OK`
```json
[
  {
    "product": {
      "name": "Beef Burger",
      "category": {
        "name": "Main Courses"
      }
    },
    "quantitySold": 45,
    "revenue": "719.55"
  }
]
```

---

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

**Common Status Codes:**
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `500` - Internal Server Error

---

## Rate Limiting

- **Default:** 100 requests per minute per IP
- **Auth endpoints:** 5 requests per minute per IP

---

## Pagination

List endpoints support pagination:

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)

**Response includes:**
```json
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

---

For more details, visit the interactive API documentation at:
**http://localhost:3000/api/docs**
