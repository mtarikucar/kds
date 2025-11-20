import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase, createTestTenant, getAuthToken } from '../src/common/test/test-helpers';

describe('Orders and Payments E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let userId: string;
  let categoryId: string;
  let productIds: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    prisma = app.get<PrismaService>(PrismaService);

    await app.init();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    // Create test tenant and user
    const { tenant, user } = await createTestTenant(prisma);
    tenantId = tenant.id;
    userId = user.id;
    authToken = getAuthToken(user);

    // Create category
    const category = await prisma.category.create({
      data: {
        name: 'Main Dishes',
        slug: 'main-dishes',
        isActive: true,
        tenantId,
      },
    });
    categoryId = category.id;

    // Create products
    const products = await Promise.all([
      prisma.product.create({
        data: {
          name: 'Burger',
          slug: 'burger',
          price: 15.99,
          isAvailable: true,
          categoryId,
          tenantId,
        },
      }),
      prisma.product.create({
        data: {
          name: 'Pizza',
          slug: 'pizza',
          price: 12.99,
          isAvailable: true,
          categoryId,
          tenantId,
        },
      }),
      prisma.product.create({
        data: {
          name: 'Fries',
          slug: 'fries',
          price: 4.99,
          isAvailable: true,
          categoryId,
          tenantId,
        },
      }),
    ]);
    productIds = products.map((p) => p.id);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('POST /orders - Create Order', () => {
    it('should create a new order with products', async () => {
      const orderDto = {
        items: [
          { productId: productIds[0], quantity: 2, notes: 'No onions' },
          { productId: productIds[2], quantity: 1 },
        ],
        orderType: 'DINE_IN',
        notes: 'Table 5',
      };

      const response = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderDto)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.orderNumber).toBeDefined();
      expect(response.body.status).toBe('PENDING');
      expect(response.body.items).toHaveLength(2);
      expect(response.body.totalAmount).toBeCloseTo(36.97, 2); // (15.99 * 2) + 4.99
    });

    it('should create order with table assignment', async () => {
      // Create table first
      const table = await prisma.table.create({
        data: {
          number: '5',
          capacity: 4,
          status: 'AVAILABLE',
          tenantId,
        },
      });

      const orderDto = {
        items: [{ productId: productIds[0], quantity: 1 }],
        orderType: 'DINE_IN',
        tableId: table.id,
      };

      const response = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderDto)
        .expect(201);

      expect(response.body.tableId).toBe(table.id);

      // Verify table status updated
      const updatedTable = await prisma.table.findUnique({ where: { id: table.id } });
      expect(updatedTable.status).toBe('OCCUPIED');
    });

    it('should reject order with unavailable product', async () => {
      // Create unavailable product
      const unavailable = await prisma.product.create({
        data: {
          name: 'Sold Out',
          slug: 'sold-out',
          price: 9.99,
          isAvailable: false,
          categoryId,
          tenantId,
        },
      });

      const orderDto = {
        items: [{ productId: unavailable.id, quantity: 1 }],
        orderType: 'DINE_IN',
      };

      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderDto)
        .expect(400);
    });

    it('should reject order with invalid product', async () => {
      const orderDto = {
        items: [{ productId: 'invalid-id', quantity: 1 }],
        orderType: 'DINE_IN',
      };

      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send(orderDto)
        .expect(400);
    });
  });

  describe('GET /orders - List Orders', () => {
    beforeEach(async () => {
      // Create sample orders
      await Promise.all([
        prisma.order.create({
          data: {
            orderNumber: 'ORD-001',
            status: 'PENDING',
            orderType: 'DINE_IN',
            totalAmount: 15.99,
            finalAmount: 15.99,
            tenantId,
            createdById: userId,
          },
        }),
        prisma.order.create({
          data: {
            orderNumber: 'ORD-002',
            status: 'PREPARING',
            orderType: 'TAKEAWAY',
            totalAmount: 25.50,
            finalAmount: 25.50,
            tenantId,
            createdById: userId,
          },
        }),
      ]);
    });

    it('should list all orders for tenant', async () => {
      const response = await request(app.getHttpServer())
        .get('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(2);
    });

    it('should filter orders by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/orders?status=PENDING')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe('PENDING');
    });

    it('should paginate results', async () => {
      const response = await request(app.getHttpServer())
        .get('/orders?page=1&limit=1')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(1);
    });
  });

  describe('PATCH /orders/:id/status - Update Order Status', () => {
    let orderId: string;

    beforeEach(async () => {
      const order = await prisma.order.create({
        data: {
          orderNumber: 'ORD-TEST',
          status: 'PENDING',
          orderType: 'DINE_IN',
          totalAmount: 15.99,
          finalAmount: 15.99,
          tenantId,
          createdById: userId,
        },
      });
      orderId = order.id;
    });

    it('should update order status to PREPARING', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'PREPARING' })
        .expect(200);

      expect(response.body.status).toBe('PREPARING');
    });

    it('should update order status to READY', async () => {
      // First set to PREPARING
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'PREPARING' },
      });

      const response = await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'READY' })
        .expect(200);

      expect(response.body.status).toBe('READY');
    });

    it('should reject status update for paid order', async () => {
      // Set order as paid
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAID' },
      });

      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'PREPARING' })
        .expect(400);
    });
  });

  describe('POST /orders/:id/payments - Process Payment', () => {
    let orderId: string;

    beforeEach(async () => {
      const order = await prisma.order.create({
        data: {
          orderNumber: 'ORD-PAY',
          status: 'READY',
          orderType: 'DINE_IN',
          totalAmount: 50.00,
          finalAmount: 50.00,
          tenantId,
          createdById: userId,
        },
      });
      orderId = order.id;
    });

    it('should process cash payment', async () => {
      const paymentDto = {
        method: 'CASH',
        amount: 50.00,
      };

      const response = await request(app.getHttpServer())
        .post(`/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(paymentDto)
        .expect(201);

      expect(response.body.method).toBe('CASH');
      expect(response.body.amount).toBe(50.00);
      expect(response.body.status).toBe('COMPLETED');

      // Verify order status updated to PAID
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order.status).toBe('PAID');
    });

    it('should process split payment', async () => {
      const payment1Dto = {
        method: 'CASH',
        amount: 30.00,
      };

      const payment2Dto = {
        method: 'CARD',
        amount: 20.00,
      };

      // First payment
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(payment1Dto)
        .expect(201);

      // Second payment
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(payment2Dto)
        .expect(201);

      // Verify order is paid
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payments: true },
      });
      expect(order.status).toBe('PAID');
      expect(order.payments).toHaveLength(2);
    });

    it('should reject overpayment', async () => {
      const paymentDto = {
        method: 'CASH',
        amount: 100.00, // More than order total
      };

      await request(app.getHttpServer())
        .post(`/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(paymentDto)
        .expect(400);
    });
  });

  describe('Complete Order Flow', () => {
    it('should handle full order lifecycle: create -> prepare -> ready -> pay', async () => {
      // 1. Create order
      const createResponse = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          items: [
            { productId: productIds[0], quantity: 1 },
            { productId: productIds[1], quantity: 1 },
          ],
          orderType: 'DINE_IN',
        })
        .expect(201);

      const orderId = createResponse.body.id;
      expect(createResponse.body.status).toBe('PENDING');

      // 2. Update to PREPARING
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'PREPARING' })
        .expect(200);

      // 3. Update to READY
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'READY' })
        .expect(200);

      // 4. Process payment
      const totalAmount = createResponse.body.finalAmount;
      await request(app.getHttpServer())
        .post(`/orders/${orderId}/payments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          method: 'CASH',
          amount: totalAmount,
        })
        .expect(201);

      // 5. Verify final state
      const finalOrder = await prisma.order.findUnique({
        where: { id: orderId },
        include: { payments: true },
      });

      expect(finalOrder.status).toBe('PAID');
      expect(finalOrder.payments).toHaveLength(1);
      expect(finalOrder.payments[0].status).toBe('COMPLETED');
    });
  });
});
