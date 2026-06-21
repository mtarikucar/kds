import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  bootHttpApp,
  resetDb,
  seedLiveTenant,
  loginAs,
} from "./helpers/e2e-db";

/**
 * HTTP-level coverage for the auth surface that the recurring phone problem
 * touched: phone is required at registration (the actual user complaint), the
 * profile endpoint returns it, and the post-social-login /complete-profile
 * endpoint persists it through the real validation + transaction stack.
 */
describe("Auth (HTTP, real validation)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await bootHttpApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function seedTrialPlan() {
    await prisma.subscriptionPlan.create({
      data: {
        name: "TRIAL",
        displayName: "Trial",
        monthlyPrice: "0.00",
        yearlyPrice: "0.00",
        trialDays: 7,
      },
    });
  }

  it("rejects registration without a phone (the recurring complaint)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email: `no-phone-${Date.now()}@example.com`,
        password: "Passw0rd1",
        firstName: "No",
        lastName: "Phone",
        restaurantName: "Diner",
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/phone/i);
  });

  it("registers with a phone, then login + profile surface it", async () => {
    await seedTrialPlan();
    const email = `with-phone-${Date.now()}@example.com`;

    await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({
        email,
        password: "Passw0rd1",
        firstName: "Has",
        lastName: "Phone",
        restaurantName: "Diner",
        phone: "0555 123 45 67",
      })
      .expect(201);

    const token = await loginAs(app, email, "Passw0rd1");
    const profile = await request(app.getHttpServer())
      .get("/api/auth/profile")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // NormalizePhone("TR") stored it as E.164.
    expect(profile.body.phone).toBe("+905551234567");
  });

  it("complete-profile fills phone + business for a phoneless account", async () => {
    const t = await seedLiveTenant(prisma); // user seeded without a phone
    const token = await loginAs(app, t.email, t.password);

    await request(app.getHttpServer())
      .post("/api/auth/complete-profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        phone: "+905559998877",
        businessName: "Completed Diner",
        taxOffice: "Kadıköy",
      })
      .expect(201);

    const user = await prisma.user.findUnique({ where: { id: t.userId } });
    expect(user!.phone).toBe("+905559998877");
    const tenant = await prisma.tenant.findUnique({
      where: { id: t.tenantId },
    });
    expect(tenant!.name).toBe("Completed Diner");
    expect(tenant!.taxOffice).toBe("Kadıköy");
  });
});
