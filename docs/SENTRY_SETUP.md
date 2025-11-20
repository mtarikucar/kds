# Sentry Error Tracking Setup Guide

This guide explains how to set up Sentry error tracking and performance monitoring for the Restaurant POS system.

## Overview

Sentry is integrated into both frontend and backend applications to provide:
- Real-time error tracking and alerts
- Performance monitoring
- Session replay (frontend only)
- User context and breadcrumbs
- Source map support for debugging minified code

## Prerequisites

1. Create a Sentry account at [sentry.io](https://sentry.io)
2. Create two projects in Sentry:
   - `restaurant-pos-frontend` (React)
   - `restaurant-pos-backend` (Node.js)

## Configuration

### 1. Environment Variables

#### Backend (.env)

Add these variables to your `backend/.env` file:

```bash
# Sentry Error Tracking
SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
SENTRY_ENVIRONMENT=production  # or development, staging
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of transactions
SENTRY_PROFILES_SAMPLE_RATE=0.1  # 10% profiling
```

#### Frontend (.env)

Add these variables to your `frontend/.env` file:

```bash
# Sentry Error Tracking
VITE_SENTRY_DSN=https://your-dsn@sentry.io/your-project-id
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of transactions
VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1  # 10% of sessions
VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1.0  # 100% when error occurs
```

### 2. Get Your DSN

1. Go to **Settings** > **Projects** > Select your project
2. Go to **Client Keys (DSN)**
3. Copy the DSN value
4. Add it to your `.env` file

### 3. Configure Environment

Set `SENTRY_ENVIRONMENT` based on your deployment:
- `development` - Local development
- `staging` - Staging environment
- `production` - Production environment

## Features

### Error Tracking

Errors are automatically captured in:

**Backend:**
- Unhandled exceptions
- HTTP 5xx errors
- Database errors (Prisma)
- Business logic exceptions

**Frontend:**
- Unhandled JavaScript errors
- React component errors (via ErrorBoundary)
- Promise rejections
- Network failures

### Performance Monitoring

**Sample Rates:**
- `TRACES_SAMPLE_RATE`: Percentage of transactions to monitor (0.0 to 1.0)
  - Development: 1.0 (100%)
  - Production: 0.1 (10%) recommended for cost efficiency

**What's monitored:**
- Backend: API endpoint response times, database queries
- Frontend: Page loads, component renders, network requests

### Session Replay (Frontend Only)

Records user sessions to replay errors in context:
- `REPLAYS_SESSION_SAMPLE_RATE`: Random session recording rate
- `REPLAYS_ON_ERROR_SAMPLE_RATE`: Always record when error occurs

**Privacy:**
- All text is masked by default
- All media is blocked by default
- No sensitive data is recorded

### User Context

User information is automatically attached to errors:
- User ID
- Email
- Tenant ID (backend only)

### Breadcrumbs

Automatic breadcrumb tracking:
- API calls
- User interactions
- Console messages
- Navigation events

## Manual Error Reporting

You can manually capture errors and messages:

### Backend

```typescript
import { captureException, captureMessage, setUser, setContext } from './sentry.config';

// Capture exception
try {
  // your code
} catch (error) {
  captureException(error, { customData: 'value' });
}

// Capture message
captureMessage('Something noteworthy happened', 'info');

// Set user context
setUser({ id: '123', email: 'user@example.com', username: 'john' });

// Add custom context
setContext('payment', {
  amount: 100,
  currency: 'USD',
  provider: 'stripe',
});
```

### Frontend

```typescript
import { captureException, captureMessage, setUser, addBreadcrumb } from './sentry.config';

// Capture exception
try {
  // your code
} catch (error) {
  captureException(error, { component: 'OrderForm' });
}

// Capture message
captureMessage('User completed checkout', 'info');

// Set user context
setUser({ id: '123', email: 'user@example.com', tenantId: 'abc' });

// Add breadcrumb
addBreadcrumb('User clicked checkout button', { orderId: '456' });
```

## Source Maps

Source maps are configured to provide readable stack traces:

**Frontend:**
- Production: Hidden source maps (not exposed to users)
- Development: Full source maps

**Backend:**
- Always enabled via TypeScript compiler

### Uploading Source Maps to Sentry (Optional)

For better error debugging, upload source maps to Sentry:

1. Install Sentry CLI:
```bash
npm install -g @sentry/cli
```

2. Create `.sentryclirc` file in project root:
```ini
[defaults]
url=https://sentry.io/
org=your-org-name
project=restaurant-pos-frontend

[auth]
token=your-auth-token
```

3. Add build script to upload source maps:

**Frontend (package.json):**
```json
{
  "scripts": {
    "build": "vite build",
    "build:sentry": "vite build && sentry-cli sourcemaps upload --release=$npm_package_version ./dist"
  }
}
```

**Backend (package.json):**
```json
{
  "scripts": {
    "build": "nest build",
    "build:sentry": "nest build && sentry-cli sourcemaps upload --release=$npm_package_version ./dist"
  }
}
```

## Testing Sentry Integration

### Backend Test

Create a test endpoint (remove in production):

```typescript
@Get('/test-sentry')
testSentry() {
  throw new Error('Test Sentry integration');
}
```

Visit: `http://localhost:3000/api/test-sentry`

### Frontend Test

Add a test button (remove in production):

```tsx
<button onClick={() => { throw new Error('Test Sentry integration'); }}>
  Test Sentry
</button>
```

## Sentry Dashboard

After configuration, check your Sentry dashboard:

1. **Issues**: View all captured errors
2. **Performance**: Monitor transaction times
3. **Replays**: Watch user sessions (frontend only)
4. **Releases**: Track errors by version
5. **Alerts**: Set up email/Slack notifications

## Recommended Alerts

Set up alerts in Sentry for:

1. **New Issues**: When a new error occurs
2. **Issue Regression**: When a resolved issue reoccurs
3. **High Error Rate**: When error rate exceeds threshold
4. **Performance Degradation**: When response time increases

## Privacy & Security

**Data Filtering:**
- Passwords, tokens, and API keys are automatically redacted
- Authorization headers are removed
- Sensitive query parameters are masked

**What's NOT sent to Sentry:**
- Request bodies with sensitive data
- Authentication credentials
- Personal identifiable information (PII)
- localStorage/sessionStorage contents

## Troubleshooting

### No errors appearing in Sentry

1. Check that `SENTRY_DSN` is set correctly
2. Verify the DSN is for the correct project
3. Ensure environment allows external requests
4. Check console for Sentry initialization message

### Source maps not working

1. Verify source maps are being generated during build
2. Check that source maps are uploaded to Sentry
3. Ensure release version matches between code and uploaded maps

### Too many events/quota exceeded

1. Reduce `TRACES_SAMPLE_RATE` (e.g., from 0.1 to 0.05)
2. Reduce `REPLAYS_SESSION_SAMPLE_RATE`
3. Filter out noisy errors in Sentry dashboard
4. Upgrade Sentry plan for higher quota

## Cost Optimization

**Free Tier:**
- 5,000 errors/month
- 10,000 performance units/month

**Tips to stay within limits:**
- Use 0.1 (10%) sample rate in production
- Filter out common/expected errors
- Use separate projects for staging/production
- Implement error grouping and deduplication

## Support

- Sentry Documentation: https://docs.sentry.io/
- Sentry Support: https://sentry.io/support/
- Internal: Contact DevOps team

## Next Steps

1. ✅ Environment variables configured
2. ✅ Sentry initialized in both apps
3. ✅ Error tracking integrated
4. ✅ Source maps configured
5. ⏭️ Set up Sentry alerts
6. ⏭️ Configure source map uploads (optional)
7. ⏭️ Test error tracking in staging
8. ⏭️ Monitor errors in production
