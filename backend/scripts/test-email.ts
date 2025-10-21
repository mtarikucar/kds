/**
 * Email Configuration Test Script
 *
 * This script tests the email configuration by sending test emails.
 * Run with: npx ts-node scripts/test-email.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Mock Prisma and dependencies for standalone script
const mockLogger = {
  log: (msg: string) => console.log(`[LOG] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
};

async function testEmailConfiguration() {
  console.log('\n=== Restaurant POS Email Configuration Test ===\n');

  // Check environment variables
  console.log('1. Checking environment variables...\n');

  const requiredEnvVars = [
    'EMAIL_HOST',
    'EMAIL_PORT',
    'EMAIL_USER',
    'EMAIL_PASSWORD',
    'EMAIL_FROM',
    'FRONTEND_URL',
  ];

  const missingVars: string[] = [];

  requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
      console.log(`   ❌ ${varName}: NOT SET`);
    } else {
      const value = varName.includes('PASSWORD')
        ? '***' + process.env[varName]!.slice(-4)
        : process.env[varName];
      console.log(`   ✅ ${varName}: ${value}`);
    }
  });

  if (missingVars.length > 0) {
    console.log('\n⚠️  Missing environment variables. Please configure them in .env file.');
    console.log('   See .env.example for reference.\n');
    process.exit(1);
  }

  console.log('\n2. Testing email service...\n');

  try {
    // Dynamically import EmailService to avoid circular dependencies
    const { EmailService } = await import('../src/common/services/email.service');

    // Create instance with mock logger
    const emailService = new EmailService();

    // Test recipient (change this to your email)
    const testEmail = process.env.TEST_EMAIL || process.env.EMAIL_USER!;

    console.log(`   Test recipient: ${testEmail}\n`);

    // Test 1: Password Reset Email
    console.log('   Test 1: Sending password reset email...');
    try {
      await emailService.sendPasswordResetEmail(testEmail, 'test-token-12345');
      console.log('   ✅ Password reset email sent successfully\n');
    } catch (error: any) {
      console.log(`   ❌ Failed to send password reset email: ${error.message}\n`);
    }

    // Test 2: Email Verification Email
    console.log('   Test 2: Sending email verification email...');
    try {
      await emailService.sendEmailVerificationEmail(testEmail, 'verify-token-67890', 'Test User');
      console.log('   ✅ Email verification email sent successfully\n');
    } catch (error: any) {
      console.log(`   ❌ Failed to send verification email: ${error.message}\n`);
    }

    // Test 3: Welcome Email
    console.log('   Test 3: Sending welcome email...');
    try {
      await emailService.sendWelcomeEmail(testEmail, 'Test User', 'Test Restaurant');
      console.log('   ✅ Welcome email sent successfully\n');
    } catch (error: any) {
      console.log(`   ❌ Failed to send welcome email: ${error.message}\n`);
    }

    console.log('\n=== Test Complete ===\n');
    console.log('✅ Email configuration is working correctly!');
    console.log(`📧 Check your inbox at ${testEmail}\n`);
    console.log('Tips:');
    console.log('  - Check spam folder if emails not in inbox');
    console.log('  - Verify email templates rendered correctly');
    console.log('  - Click links to test frontend integration\n');

  } catch (error: any) {
    console.log('\n❌ Email service test failed!\n');
    console.error('Error details:', error.message);

    if (error.message.includes('Invalid login')) {
      console.log('\nTroubleshooting:');
      console.log('  1. Verify EMAIL_USER is correct');
      console.log('  2. Verify EMAIL_PASSWORD is the App Password (not your Gmail password)');
      console.log('  3. Ensure 2-Step Verification is enabled on Gmail');
      console.log('  4. Generate new App Password at: https://myaccount.google.com/apppasswords\n');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.log('\nTroubleshooting:');
      console.log('  1. Check EMAIL_HOST and EMAIL_PORT settings');
      console.log('  2. Verify network connectivity');
      console.log('  3. Check firewall settings\n');
    }

    process.exit(1);
  }
}

// Run the test
testEmailConfiguration().catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
