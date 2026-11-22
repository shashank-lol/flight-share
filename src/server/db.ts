import {PrismaClient} from '@prisma/client';

const shared = globalThis as typeof globalThis & { flightSharePrisma?: PrismaClient };
export const prisma = shared.flightSharePrisma ??= new PrismaClient();