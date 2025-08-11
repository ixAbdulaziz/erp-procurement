const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['error', 'warn'] // فعل 'query' عند الحاجة
});

module.exports = prisma;
