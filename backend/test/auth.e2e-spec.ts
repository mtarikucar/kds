import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanDatabase } from '../src/common/test/test-helpers';

describe('Authentication E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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

    // Seed subscription plans
    await prisma.subscriptionPlan.createMany({
      data: [
        {
          name: 'FREE',
          displayName: 'Free Plan',
          price: 0,
          interval: 'MONTHLY',
          features: {},
          maxUsers: 2,
          maxProducts: 20,
          isActive: true,
        },
        {
          name: 'PRO',
          displayName: 'Pro Plan',
          price: 49.99,
          interval: 'MONTHLY',
          features: {},
          maxUsers: 10,
          maxProducts: 500,
          isActive: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('should register a new admin user with restaurant', async () => {
      const registerDto = {
        email: 'admin@test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
        restaurantName: 'Test Restaurant',
        paymentRegion: 'INTERNATIONAL',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user).toMatchObject({
        email: registerDto.email,
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        role: 'ADMIN',
      });

      // Verify tenant was created
      const tenant = await prisma.tenant.findUnique({
        where: { id: response.body.user.tenantId },
      });
      expect(tenant).toBeDefined();
      expect(tenant.name).toBe(registerDto.restaurantName);
    });

    it('should register a staff user joining existing tenant', async () => {
      // Create tenant first
      const tenant = await prisma.tenant.create({
        data: {
          name: 'Existing Restaurant',
          subdomain: 'existing',
          subscriptionTier: 'FREE',
          subscriptionStatus: 'ACTIVE',
        },
      });

      const registerDto = {
        email: 'waiter@test.com',
        password: 'Password123!',
        firstName: 'Waiter',
        lastName: 'User',
        tenantId: tenant.id,
        role: 'WAITER',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      expect(response.body.user.role).toBe('WAITER');
      expect(response.body.user.tenantId).toBe(tenant.id);
    });

    it('should reject duplicate email', async () => {
      const registerDto = {
        email: 'duplicate@test.com',
        password: 'Password123!',
        firstName: 'Test',
        lastName: 'User',
        restaurantName: 'Test Restaurant',
      };

      // First registration
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(201);

      // Duplicate registration
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerDto)
        .expect(409);
    });

    it('should reject invalid email format', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Password123!',
          firstName: 'Test',
          lastName: 'User',
          restaurantName: 'Test Restaurant',
        })
        .expect(400);
    });

    it('should reject weak password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'test@test.com',
          password: '123', // Too short
          firstName: 'Test',
          lastName: 'User',
          restaurantName: 'Test Restaurant',
        })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    let userEmail: string;
    let userPassword: string;

    beforeEach(async () => {
      userEmail = 'login@test.com';
      userPassword = 'Password123!';

      // Register a user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: userEmail,
          password: userPassword,
          firstName: 'Test',
          lastName: 'User',
          restaurantName: 'Test Restaurant',
        });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userEmail,
          password: userPassword,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user.email).toBe(userEmail);
    });

    it('should reject invalid password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userEmail,
          password: 'WrongPassword123!',
        })
        .expect(401);
    });

    it('should reject non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'Password123!',
        })
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      // Register and login
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'refresh@test.com',
          password: 'Password123!',
          firstName: 'Test',
          lastName: 'User',
          restaurantName: 'Test Restaurant',
        });

      const refreshToken = registerResponse.body.refreshToken;

      // Refresh the token
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.refreshToken).not.toBe(refreshToken); // Should be new token
    });

    it('should reject invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('should get current user with valid token', async () => {
      // Register
      const registerResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'me@test.com',
          password: 'Password123!',
          firstName: 'Current',
          lastName: 'User',
          restaurantName: 'Test Restaurant',
        });

      const accessToken = registerResponse.body.accessToken;

      // Get current user
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.email).toBe('me@test.com');
      expect(response.body.firstName).toBe('Current');
    });

    it('should reject request without token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);
    });

    it('should reject request with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should send password reset email for existing user', async () => {
      const email = 'forgot@test.com';

      // Register user
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          password: 'Password123!',
          firstName: 'Test',
          lastName: 'User',
          restaurantName: 'Test Restaurant',
        });

      // Request password reset
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(200);

      // Verify reset token was created
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user.passwordResetToken).toBeDefined();
      expect(user.passwordResetExpires).toBeDefined();
    });

    it('should not reveal if email does not exist', async () => {
      // Should return 200 even for non-existent email (security best practice)
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' })
        .expect(200);
    });
  });
});
