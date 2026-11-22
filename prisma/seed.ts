import {PrismaClient} from '@prisma/client';
import {flightKey, localDate} from '../src/domain/flights';

const prisma = new PrismaClient();

async function seed() {
  if (process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Set ALLOW_DEMO_SEED=true on an isolated demo database.');
  const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Demo seeding requires a loopback APP_ORIGIN.');
  const departureDate = localDate(7);
  const flight = {airline: 'BA', flightNumber: '117', departureAirport: 'LHR', arrivalAirport: 'JFK', departureTime: '08:25'};
  const instanceKey = flightKey({...flight, departureDate});
  const inputs = [
    {name: 'Amelia Carter', email: 'amelia@example.test', alias: 'Traveller AM01', allowance: 23, expected: 19, cab: true, anonymous: false},
    {name: 'Daniel Park', email: 'daniel@example.test', alias: 'Traveller DP02', allowance: 23, expected: 26, cab: false, anonymous: false},
    {name: 'Sky Example', email: 'sky@example.test', alias: 'Traveller SK03', allowance: 23, expected: 15, cab: true, anonymous: true},
  ];
  await prisma.$transaction(async (tx) => {
    const room = await tx.flight.upsert({where: {instanceKey}, create: {...flight, departureDate: new Date(`${departureDate}T00:00:00.000Z`), instanceKey}, update: {}});
    for (const person of inputs) {
      const user = await tx.user.upsert({where: {email: person.email}, create: {email: person.email, emailVerified: new Date()}, update: {}});
      await tx.passengerProfile.upsert({where: {userId: user.id}, create: {userId: user.id, displayName: person.name, isAnonymous: person.anonymous, transportation: person.cab ? 'CAB_SHARE' : 'NONE', companionship: true}, update: {}});
      await tx.flightMembership.upsert({where: {flightId_userId: {flightId: room.id, userId: user.id}}, create: {flightId: room.id, userId: user.id, alias: person.alias, baggageAllowance: person.allowance, expectedBaggageWeight: person.expected, verificationStatus: 'MOCK', rideOptIn: person.cab, pickupArea: person.cab ? 'Central London' : null}, update: {}});
      await tx.verificationRecord.upsert({where: {userId_flightId: {flightId: room.id, userId: user.id}}, create: {userId: user.id, flightId: room.id, verificationMethod: 'DEMO_SEED', verificationStatus: 'MOCK'}, update: {}});
      if (person.cab) await tx.flightMembership.updateMany({where: {flightId: room.id, userId: user.id, verificationStatus: 'MOCK'}, data: {rideOptIn: true, pickupArea: 'Central London'}});
      if (person.name === 'Amelia Carter') await tx.flightGroupMessage.upsert({
        where: {flightId_senderId_clientId: {flightId: room.id, senderId: user.id, clientId: 'demo-welcome-v2'}},
        create: {flightId: room.id, senderId: user.id, clientId: 'demo-welcome-v2', content: 'Welcome to the demo flight! We can use this chat to share general travel tips. Check your airline for official updates.'}, update: {},
      });
    }
    const nearby = {...flight, airline: 'AA', flightNumber: '101', departureTime: '08:45'};
    const nearbyKey = flightKey({...nearby, departureDate});
    const other = await tx.flight.upsert({where: {instanceKey: nearbyKey}, create: {...nearby, departureDate: new Date(`${departureDate}T00:00:00.000Z`), instanceKey: nearbyKey}, update: {}});
    const rider = await tx.user.upsert({where: {email: 'riley@example.test'}, create: {email: 'riley@example.test', emailVerified: new Date()}, update: {}});
    await tx.passengerProfile.upsert({where: {userId: rider.id}, create: {userId: rider.id, displayName: 'Riley', showBaggage: false}, update: {}});
    await tx.flightMembership.upsert({where: {flightId_userId: {flightId: other.id, userId: rider.id}}, create: {flightId: other.id, userId: rider.id, alias: 'Traveller RI04', baggageAllowance: 0, expectedBaggageWeight: 0, baggageReported: false, partySize: 2, rideOptIn: true, pickupArea: 'West London', verificationStatus: 'MOCK'}, update: {}});
  });
  console.log(`Seeded the BA 117 and nearby AA 101 development rooms for ${departureDate}.`);
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Demo data could not be seeded.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());