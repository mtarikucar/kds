import * as nodemailer from "nodemailer";
import { MailerService } from "./mailer.service";
import { captureException } from "../../sentry.config";

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));
jest.mock("../../sentry.config", () => ({ captureException: jest.fn() }));
jest.mock("fs", () => ({ readFileSync: jest.fn().mockReturnValue("<b>{{name}}</b>") }));

const createTransport = nodemailer.createTransport as jest.Mock;

/**
 * Long-tail spec for the contact-form mailer. Load-bearing contracts:
 * with no SMTP config the transporter is never built and the send returns
 * false (a missing config must not throw into the request); a successful
 * send returns true; an SMTP failure returns false AND reports to Sentry
 * (a dropped admin email = a lost lead, so it must be alertable).
 */
describe("MailerService.sendAdminNotification", () => {
  const ORIGINAL = { ...process.env };
  const data = { name: "Jane", email: "jane@example.com", message: "hi there" };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.clearAllMocks();
  });

  function configureSmtp() {
    process.env.EMAIL_HOST = "smtp.example.com";
    process.env.EMAIL_PORT = "587";
    process.env.EMAIL_USER = "u";
    process.env.EMAIL_PASSWORD = "p";
  }

  it("returns false and never builds a transporter when SMTP is unconfigured", async () => {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_PORT;
    const svc = new MailerService();
    await expect(svc.sendAdminNotification(data)).resolves.toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("returns true after a successful sendMail", async () => {
    configureSmtp();
    const sendMail = jest.fn().mockResolvedValue({});
    createTransport.mockReturnValue({ sendMail });
    const svc = new MailerService();
    await expect(svc.sendAdminNotification(data)).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalled();
  });

  it("returns false and reports to Sentry when sendMail throws", async () => {
    configureSmtp();
    const sendMail = jest.fn().mockRejectedValue(new Error("SMTP down"));
    createTransport.mockReturnValue({ sendMail });
    const svc = new MailerService();
    await expect(svc.sendAdminNotification(data)).resolves.toBe(false);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ module: "contact" }),
    );
  });
});
