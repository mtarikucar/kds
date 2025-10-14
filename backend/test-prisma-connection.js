const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:postgres@127.0.0.1:5432/restaurant_pos?schema=public"
    }
  },
  log: ['query', 'info', 'warn', 'error'],
});

async function main() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully!');

    const result = await prisma.$queryRaw`SELECT current_user, current_database()`;
    console.log('Query result:', result);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Connection failed:', error);
    process.exit(1);
  }
}

main();
