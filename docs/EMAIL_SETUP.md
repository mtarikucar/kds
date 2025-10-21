# Email Configuration and Testing Guide

This guide covers setting up and testing email functionality in the Restaurant POS system.

## Gmail SMTP Setup

### Prerequisites
- Gmail account with 2-Step Verification enabled
- App Password generated for the application

### Step 1: Enable 2-Step Verification

1. Go to [Google Account Security Settings](https://myaccount.google.com/security)
2. Under "Signing in to Google", select "2-Step Verification"
3. Follow the prompts to enable 2-Step Verification

### Step 2: Generate App Password

1. Go to [App Passwords](https://myaccount.google.com/apppasswords)
2. Select "Mail" as the app
3. Select "Other (Custom name)" as the device
4. Enter "Restaurant POS" as the custom name
5. Click "Generate"
6. Copy the 16-character password (remove spaces)

### Step 3: Configure Environment Variables

Update your `.env` file (or `.env.production` for production) with:

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-16-char-app-password
EMAIL_FROM=Restaurant POS <noreply@restaurant-pos.com>

# Frontend URL (for links in emails)
FRONTEND_URL=http://localhost:5173
# or for production:
# FRONTEND_URL=https://yourapp.com

# Application name (used in email templates)
APP_NAME=Restaurant POS
```

**Important Notes:**
- `EMAIL_SECURE` should be `false` for port 587 (TLS/STARTTLS)
- Use `EMAIL_SECURE=true` only with port 465 (SSL)
- The `EMAIL_FROM` name will appear as the sender in emails

## Testing Email Functionality

### Test 1: Password Reset Email

**Using the API:**

```bash
# Send password reset email
curl -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Expected response:
# {
#   "message": "If an account with that email exists, a password reset link has been sent."
# }
```

**Using the Frontend:**

1. Navigate to `http://localhost:5173/login`
2. Click "Forgot password?"
3. Enter your email address
4. Click "Send Reset Link"
5. Check your email inbox

**Verify Email Contents:**
- Subject: "Reset Your Password"
- Contains a reset button/link
- Link format: `http://localhost:5173/reset-password?token=<uuid>`
- Contains security warnings (1-hour expiry, don't share link)
- Professional HTML formatting

### Test 2: Email Verification Email

**Note:** Email verification endpoints need to be implemented in the backend first.

```bash
# Resend verification email (requires authentication)
curl -X POST http://localhost:3000/api/auth/resend-verification \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"
```

### Test 3: Welcome Email

The welcome email is sent automatically after successful registration.

**Using the API:**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePass123!",
    "name": "Test User",
    "restaurantName": "Test Restaurant"
  }'
```

**Using the Frontend:**

1. Navigate to `http://localhost:5173/register`
2. Fill in the registration form
3. Submit the form
4. Check email inbox for welcome email

## Email Templates

The system includes three pre-built email templates:

### 1. Password Reset (`password-reset.hbs`)
- **Location:** `backend/templates/emails/password-reset.hbs`
- **Variables:** `userName`, `resetUrl`, `resetToken`
- **Features:** Professional design, prominent CTA button, security warnings

### 2. Email Verification (`email-verification.hbs`)
- **Location:** `backend/templates/emails/email-verification.hbs`
- **Variables:** `userName`, `verifyUrl`, `token`
- **Features:** Explains verification benefits, clear CTA

### 3. Welcome Email (`welcome.hbs`)
- **Location:** `backend/templates/emails/welcome.hbs`
- **Variables:** `userName`, `restaurantName`, `appUrl`
- **Features:** Feature highlights, onboarding guidance

## Troubleshooting

### Issue: Emails not sending

**Check Backend Logs:**
```bash
# Development
npm run dev

# Production (Docker)
docker-compose logs backend
```

**Common Causes:**

1. **Invalid App Password**
   - Verify the 16-character password is correct
   - No spaces in the password
   - Regenerate if needed

2. **2-Step Verification Not Enabled**
   - App Passwords require 2-Step Verification
   - Enable in Google Account Security settings

3. **Incorrect SMTP Settings**
   - Gmail SMTP: `smtp.gmail.com:587` with `EMAIL_SECURE=false`
   - Or: `smtp.gmail.com:465` with `EMAIL_SECURE=true`

4. **Network/Firewall Issues**
   - Ensure outbound connections to port 587/465 are allowed
   - Check Docker network configuration

### Issue: Emails going to spam

**Solutions:**

1. **Add SPF Record** (if using custom domain):
   ```
   v=spf1 include:_spf.google.com ~all
   ```

2. **Add DKIM** (if using custom domain):
   - Set up in Google Workspace or Gmail settings

3. **Use Professional Email Content:**
   - Avoid spam trigger words
   - Include unsubscribe links (for marketing emails)
   - Maintain good text-to-image ratio

### Issue: Template not rendering

**Verify Template Files:**
```bash
ls -la backend/templates/emails/
# Should show:
# - password-reset.hbs
# - email-verification.hbs
# - welcome.hbs
```

**Check Template Variables:**
- Ensure all required variables are passed
- Check template compilation in `EmailService.compileTemplate()`

## Production Considerations

### 1. Use a Dedicated Email Service (Recommended)

For production, consider using:
- **SendGrid** - 100 emails/day free, better deliverability
- **Mailgun** - 5,000 emails/month free
- **AWS SES** - $0.10 per 1,000 emails
- **Postmark** - Excellent for transactional emails

**Benefits:**
- Better deliverability rates
- Detailed analytics
- Higher sending limits
- Dedicated IPs (for high volume)

### 2. Gmail Limits

If staying with Gmail:
- **Free Gmail:** 500 emails/day
- **Google Workspace:** 2,000 emails/day
- Rate limiting: ~10 emails/minute

### 3. Email Queue (Recommended for Production)

Implement email queue with Bull/BullMQ:
```typescript
// backend/src/common/queues/email.queue.ts
import { Queue } from 'bullmq';

export const emailQueue = new Queue('emails', {
  connection: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});
```

### 4. Monitoring

Monitor email delivery:
- Log all email attempts
- Track delivery failures
- Set up alerts for high failure rates
- Monitor bounce rates

### 5. Security Best Practices

- ✅ Use environment variables for credentials
- ✅ Never commit `.env` files
- ✅ Use App Passwords (not main password)
- ✅ Implement rate limiting on email endpoints
- ✅ Validate email addresses before sending
- ✅ Use HTTPS for all email links
- ✅ Implement token expiration (1 hour for password reset)

## Testing Checklist

Before deploying to production:

- [ ] Gmail App Password generated and configured
- [ ] All three email templates render correctly
- [ ] Password reset flow works end-to-end
- [ ] Email verification flow works end-to-end
- [ ] Welcome email sends on registration
- [ ] Email links point to correct frontend URL
- [ ] Emails not going to spam folder
- [ ] Email sending errors are logged
- [ ] Frontend pages handle all email scenarios
- [ ] Token expiration works correctly
- [ ] Email rate limiting configured

## Email Flow Diagrams

### Password Reset Flow

```
User -> Forgot Password Page
  |
  v
POST /api/auth/forgot-password
  |
  v
Backend generates UUID token
  |
  v
Token saved to database (1-hour expiry)
  |
  v
Email sent with reset link
  |
  v
User clicks link in email
  |
  v
Reset Password Page (/reset-password?token=xxx)
  |
  v
POST /api/auth/reset-password
  |
  v
Backend validates token
  |
  v
Password updated, token invalidated
  |
  v
Redirect to Login Page
```

### Email Verification Flow

```
User registers
  |
  v
Backend creates user (emailVerified: false)
  |
  v
Welcome email + Verification email sent
  |
  v
User clicks verification link
  |
  v
Verify Email Page (/verify-email?token=xxx)
  |
  v
POST /api/auth/verify-email
  |
  v
Backend validates token
  |
  v
User.emailVerified = true
  |
  v
Success message -> Dashboard
```

## Support

For issues or questions:
- Check backend logs: `docker-compose logs backend`
- Review Winston logs: `backend/logs/error-*.log`
- Verify `.env` configuration
- Test with curl commands first
- Check email spam folder

## Additional Resources

- [Nodemailer Documentation](https://nodemailer.com/)
- [Gmail SMTP Settings](https://support.google.com/mail/answer/7126229)
- [Handlebars Template Guide](https://handlebarsjs.com/guide/)
- [Email Design Best Practices](https://www.campaignmonitor.com/best-practices/)
