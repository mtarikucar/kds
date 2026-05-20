/**
 * One-shot backfill for the marketing referral-code rollout.
 *
 * Run after the 20260520160000_marketing_referral_code migration to
 * generate a code for every legacy MarketingUser whose `referralCode`
 * is still null. Idempotent — re-running skips already-coded rows.
 *
 *   npx ts-node prisma/seed-marketers-referral-backfill.ts
 *
 * The deterministic e2e codes (E2EMKT99 / E2EREP88) are owned by
 * seed-platform-users.ts; this script doesn't touch rows that already
 * have a code, so the two seeders can be run in any order.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import {
  generateReferralCode,
  generateFallbackReferralCode,
} from '../src/modules/marketing/utils/referral-code';

const prisma = new PrismaClient();

const MAX_ATTEMPTS = 5;

async function allocate(firstName: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateReferralCode(firstName);
    const taken = await prisma.marketingUser.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return generateFallbackReferralCode();
}

async function main() {
  const candidates = await prisma.marketingUser.findMany({
    where: { referralCode: null },
    select: { id: true, email: true, firstName: true },
  });

  if (candidates.length === 0) {
    console.log('✅ no marketers needing referral codes — already backfilled');
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const user of candidates) {
    const code = await allocate(user.firstName);
    try {
      await prisma.marketingUser.update({
        where: { id: user.id },
        data: {
          referralCode: code,
          referralCodeUpdatedAt: new Date(),
        },
      });
      console.log(`  ${user.email.padEnd(36)} → ${code}`);
      updated++;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Racing with another invocation; try once more with a fallback.
        try {
          await prisma.marketingUser.update({
            where: { id: user.id },
            data: {
              referralCode: generateFallbackReferralCode(),
              referralCodeUpdatedAt: new Date(),
            },
          });
          updated++;
          continue;
        } catch (retryErr) {
          console.error(`  ${user.email} skipped after retry: ${(retryErr as Error).message}`);
          skipped++;
          continue;
        }
      }
      console.error(`  ${user.email} skipped: ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(`✅ backfill done — updated: ${updated}, skipped: ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
