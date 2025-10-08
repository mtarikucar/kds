# Restaurant POS System - Architecture Documentation

## System Overview

The Restaurant POS system is a full-stack web application built with modern technologies to manage restaurant operations including orders, payments, inventory, and kitchen display.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   POS App    │  │   Kitchen    │  │    Admin     │             │
│  │              │  │   Display    │  │   Dashboard  │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────────────────────────┐       │
│  │   QR Menu    │  │  React + TypeScript + Tailwind CSS  │       │
│  │  (Public)    │  │  React Router + React Query          │       │
│  └──────────────┘  └──────────────────────────────────────┘       │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    HTTP/REST + WebSocket
                               │
┌──────────────────────────────┴──────────────────────────────────────┐
│                      APPLICATION LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│              ┌─────────────────────────────────┐                    │
│              │      NestJS Backend (API)       │                    │
│              └─────────────────────────────────┘                    │
│                                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐             │
│  │  Auth   │  │  Menu   │  │ Orders  │  │   KDS    │             │
│  │ Module  │  │ Module  │  │ Module  │  │ Gateway  │             │
│  └─────────┘  └─────────┘  └─────────┘  └──────────┘             │
│                                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐             │
│  │ Tables  │  │  Stock  │  │ Reports │  │  Users   │             │
│  │ Module  │  │ Module  │  │ Module  │  │  Module  │             │
│  └─────────┘  └─────────┘  └─────────┘  └──────────┘             │
│                                                                      │
│              ┌─────────────────────────────────┐                    │
│              │  Guards & Middleware Layer      │                    │
│              │  - JWT Auth Guard               │                    │
│              │  - Roles Guard (RBAC)           │                    │
│              │  - Tenant Guard (Multi-tenancy) │                    │
│              └─────────────────────────────────┘                    │
│                                                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                          Prisma ORM
                               │
┌──────────────────────────────┴──────────────────────────────────────┐
│                       DATA LAYER                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────┐              ┌─────────────────┐           │
│  │   PostgreSQL DB    │              │   Redis Cache   │           │
│  │                    │              │                 │           │
│  │  - Tenants         │              │  - Sessions     │           │
│  │  - Users           │              │  - Queue        │           │
│  │  - Products        │              │  - WebSocket    │           │
│  │  - Orders          │              │    State        │           │
│  │  - Payments        │              │                 │           │
│  │  - Stock           │              └─────────────────┘           │
│  └────────────────────┘                                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Frontend

| Layer | Technology |
|-------|-----------|
| **Framework** | React 18 with TypeScript |
| **Build Tool** | Vite |
| **Routing** | React Router v6 |
| **State Management** | Zustand (auth) + React Query (server state) |
| **Styling** | Tailwind CSS |
| **Forms** | React Hook Form + Zod validation |
| **Real-time** | Socket.IO Client |
| **HTTP Client** | Axios |
| **Notifications** | Sonner |
| **Icons** | Lucide React |
| **Date Handling** | date-fns |

### Backend

| Layer | Technology |
|-------|-----------|
| **Framework** | NestJS |
| **Language** | TypeScript |
| **API Style** | RESTful + WebSocket |
| **Database** | PostgreSQL 15 |
| **ORM** | Prisma |
| **Cache** | Redis |
| **Authentication** | JWT (Passport) |
| **Validation** | class-validator |
| **Documentation** | Swagger/OpenAPI |
| **Real-time** | Socket.IO |
| **Password Hashing** | bcrypt |

### DevOps

| Layer | Technology |
|-------|-----------|
| **Containerization** | Docker + Docker Compose |
| **Web Server** | Nginx (production) |
| **CI/CD** | GitHub Actions |
| **Version Control** | Git |

---

## Architecture Patterns

### 1. Multi-Tenant Architecture

**Strategy:** Row-Level Security with Tenant ID

Every data entity includes a `tenantId` column that isolates data between restaurants.

```typescript
// Tenant Guard injects tenantId into request
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    request.tenantId = request.user.tenantId;
    return true;
  }
}

// Services always filter by tenant
async findAll(tenantId: string) {
  return this.prisma.product.findMany({
    where: { tenantId } // Automatic tenant isolation
  });
}
```

**Benefits:**
- Simple implementation
- Cost-effective (shared infrastructure)
- Easy to scale horizontally
- Fast tenant provisioning

**Trade-offs:**
- All tenants share same database
- Must ensure proper isolation in code
- One tenant's load can affect others

---

### 2. Role-Based Access Control (RBAC)

**Roles:**
- **ADMIN** - Full system access, tenant management
- **MANAGER** - Operations management, reports
- **WAITER** - POS operations, order creation
- **KITCHEN** - Kitchen display, order status updates
- **COURIER** - Delivery management (future)

**Implementation:**

```typescript
// Decorator for role protection
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Get('reports/sales')
async getSalesReport() {
  // Only ADMIN and MANAGER can access
}

// Guard checks user role
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get('roles', context.getHandler());
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some(role => user.role === role);
  }
}
```

---

### 3. Modular Monolith

**Why not Microservices?**
- Faster development for MVP
- Simpler deployment
- Easier debugging
- Lower operational overhead

**Modular Structure:**
Each feature is a self-contained module that can be extracted into a microservice later if needed.

```
backend/src/modules/
├── auth/          # Authentication & authorization
├── tenants/       # Multi-tenant management
├── users/         # User management
├── menu/          # Categories & products
├── orders/        # Order processing & payments
├── tables/        # Table management
├── kds/           # Kitchen Display System (WebSocket)
├── stock/         # Inventory management
└── reports/       # Analytics & reporting
```

**Migration Path:**
Each module can be extracted into a microservice by:
1. Creating a new NestJS app
2. Moving the module code
3. Setting up inter-service communication (REST/gRPC)
4. Updating API gateway routing

---

### 4. Real-Time Communication

**WebSocket Architecture:**

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│  POS Client │◄───────►│  KDS Gateway │◄───────►│ Kitchen Client│
└─────────────┘         └──────────────┘         └──────────────┘
                              │
                              │ Rooms:
                              │ - kitchen-{tenantId}
                              │ - pos-{tenantId}
                              │
                              ▼
                        ┌──────────┐
                        │  Redis   │
                        │ (Adapter)│
                        └──────────┘
```

**Events Flow:**
1. Waiter creates order → Backend creates order in DB
2. Backend emits `order:new` to `kitchen-{tenantId}` room
3. Kitchen clients receive real-time notification
4. Kitchen updates status → `order:status-changed` event
5. POS clients receive status update

**Scalability:**
- Socket.IO Redis adapter for horizontal scaling
- Multiple backend instances can share WebSocket state
- Automatic reconnection on client side

---

### 5. Authentication Flow

```
┌──────────┐                                      ┌──────────┐
│  Client  │                                      │  Server  │
└────┬─────┘                                      └────┬─────┘
     │                                                 │
     │  1. POST /auth/login                           │
     │  { email, password }                           │
     ├────────────────────────────────────────────────►
     │                                                 │
     │                                2. Validate user │
     │                                3. Hash password │
     │                                4. Generate JWT  │
     │                                                 │
     │  5. Return tokens + user                       │
     │◄────────────────────────────────────────────────┤
     │  { accessToken, refreshToken, user }           │
     │                                                 │
     │  6. Store tokens in localStorage               │
     │                                                 │
     │  7. Include in all requests                    │
     │  Authorization: Bearer <accessToken>           │
     ├────────────────────────────────────────────────►
     │                                                 │
     │                          8. JWT Guard validates │
     │                          9. Tenant Guard adds   │
     │                             tenantId to request │
     │                                                 │
     │  10. Response                                   │
     │◄────────────────────────────────────────────────┤
     │                                                 │
```

**Token Refresh:**
- Access token expires in 7 days
- Refresh token expires in 30 days
- Client auto-refreshes using interceptor

---

### 6. Order Processing Flow

```
┌──────┐    ┌─────┐    ┌──────────┐    ┌─────────┐    ┌───────┐
│ POS  │───►│Order│───►│ Kitchen  │───►│ Payment │───►│ Stock │
└──────┘    └─────┘    └──────────┘    └─────────┘    └───────┘
   │           │             │               │             │
   │           │             │               │             │
   ▼           ▼             ▼               ▼             ▼
1. Select   2. Create    3. Real-time   4. Process    5. Deduct
   table       order        update to     payment       stock
   & items                  kitchen                     for items

Status Flow:
PENDING → PREPARING → READY → SERVED → PAID
```

**Transaction Safety:**
Payment processing uses Prisma transactions:
```typescript
await prisma.$transaction([
  // 1. Create payment
  prisma.payment.create({...}),

  // 2. Update order status
  prisma.order.update({ status: 'PAID' }),

  // 3. Deduct stock
  prisma.product.update({ currentStock: { decrement: qty } }),

  // 4. Log stock movement
  prisma.stockMovement.create({...})
]);
```

---

### 7. Data Flow Patterns

**Query Pattern (Read):**
```
React Component
  └─► React Query Hook (useOrders)
      └─► Axios GET /api/orders
          └─► NestJS Controller
              └─► Service (business logic)
                  └─► Prisma (ORM)
                      └─► PostgreSQL
```

**Mutation Pattern (Write):**
```
React Component
  └─► React Query Mutation (useCreateOrder)
      └─► Axios POST /api/orders
          └─► NestJS Controller
              └─► DTO Validation (class-validator)
                  └─► Service
                      └─► Prisma Transaction
                          └─► PostgreSQL + WebSocket emit
```

---

## Database Schema Design

### Entity Relationships

```
Tenant (Restaurant)
  │
  ├──► Users (many)
  ├──► Categories (many)
  ├──► Products (many)
  ├──► Tables (many)
  ├──► Orders (many)
  └──► Stock Movements (many)

Category
  └──► Products (many)

Table
  └──► Orders (many)

Order
  ├──► Order Items (many)
  └──► Payments (many)

Order Item
  └──► Product (one)

Product
  ├──► Order Items (many)
  └──► Stock Movements (many)
```

### Key Design Decisions

1. **Multi-Tenancy:** Every table has `tenantId` foreign key
2. **Soft Deletes:** Status fields instead of deleting records
3. **Audit Trail:** `createdAt` and `updatedAt` on all tables
4. **Decimal Precision:** Prices use `Decimal(10,2)` for accuracy
5. **Composite Unique:** Table numbers unique per tenant
6. **Indexing:** Indexes on `tenantId`, foreign keys, and status fields

---

## Security Considerations

### 1. Authentication & Authorization

- ✅ JWT tokens with expiration
- ✅ Refresh token rotation
- ✅ Password hashing with bcrypt (10 rounds)
- ✅ Role-based access control
- ✅ Tenant isolation on all queries

### 2. API Security

- ✅ CORS configuration
- ✅ Request validation (DTOs)
- ✅ Rate limiting (future: add express-rate-limit)
- ✅ SQL injection prevention (Prisma ORM)
- ✅ XSS prevention (React auto-escaping)

### 3. Data Security

- ✅ Environment variables for secrets
- ✅ Database connection pooling
- ✅ Transaction-based operations
- ⚠️ TODO: Encryption at rest
- ⚠️ TODO: HTTPS in production

---

## Scalability Strategy

### Horizontal Scaling

**Current (MVP):**
- Single backend instance
- Single PostgreSQL instance
- Single Redis instance

**Scale to 100 restaurants:**
- Multiple backend instances behind load balancer
- Redis cluster for WebSocket adapter
- PostgreSQL read replicas
- CDN for static assets

**Scale to 1000+ restaurants:**
- Kubernetes orchestration
- Managed PostgreSQL (AWS RDS, DigitalOcean Managed)
- ElastiCache for Redis
- Separate microservices:
  - Orders Service
  - Kitchen Service
  - Reports Service

### Performance Optimizations

1. **Database:**
   - Indexes on frequently queried columns
   - Connection pooling
   - Query optimization with Prisma
   - Materialized views for reports

2. **Caching:**
   - Redis for session storage
   - React Query client-side cache
   - API response caching (future)

3. **Frontend:**
   - Code splitting with React Router
   - Lazy loading components
   - Image optimization
   - Production builds with minification

---

## Monitoring & Observability (Future)

**Recommended Tools:**

- **Logging:** Winston + ELK Stack
- **Monitoring:** Prometheus + Grafana
- **Error Tracking:** Sentry
- **APM:** New Relic or Datadog
- **Uptime:** UptimeRobot

**Metrics to Track:**

- API response times
- Order processing times
- WebSocket connection count
- Database query performance
- Error rates by endpoint
- Active users per tenant

---

## Deployment Architecture

### Development

```
localhost:5173 (Frontend)
     ↓
localhost:3000 (Backend API)
     ↓
localhost:5432 (PostgreSQL)
localhost:6379 (Redis)
```

### Production

```
                    ┌──────────────┐
                    │ Load Balancer│
                    │  (Nginx)     │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
     ┌────▼────┐      ┌────▼────┐     ┌────▼────┐
     │Backend 1│      │Backend 2│     │Backend 3│
     └────┬────┘      └────┬────┘     └────┬────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                  ┌────────┴────────┐
                  │                 │
            ┌─────▼─────┐    ┌──────▼──────┐
            │PostgreSQL │    │Redis Cluster│
            │  Primary  │    └─────────────┘
            └─────┬─────┘
                  │
            ┌─────▼─────┐
            │PostgreSQL │
            │  Replica  │
            └───────────┘
```

---

## Future Enhancements

### Phase 2 (3-6 months)

- [ ] Mobile apps (React Native)
- [ ] Delivery management
- [ ] Recipe/BOM tracking
- [ ] Advanced reporting with charts
- [ ] Email notifications
- [ ] SMS notifications
- [ ] Customer loyalty program

### Phase 3 (6-12 months)

- [ ] Third-party integrations (delivery platforms)
- [ ] E-invoice generation
- [ ] Multi-location support
- [ ] Advanced inventory forecasting
- [ ] Employee scheduling
- [ ] Customer relationship management (CRM)

---

## Conclusion

This architecture provides a solid foundation for a modern restaurant POS system with:

✅ **Scalability** - Can grow from 1 to 1000+ restaurants
✅ **Security** - Multi-tenant isolation, RBAC, JWT auth
✅ **Performance** - Optimized queries, caching, real-time updates
✅ **Maintainability** - Modular design, TypeScript, comprehensive testing
✅ **Developer Experience** - Modern tools, clear patterns, good documentation

The modular monolith approach allows for rapid development while maintaining a path to microservices if needed in the future.
