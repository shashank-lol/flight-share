import {PrismaClient} from '@prisma/client';
import {flightKey, localDate} from '../src/domain/flights';
import {demoBooking, demoFlight, nearbyDemoFlight} from '../src/domain/demo';

const prisma = new PrismaClient();

async function seed() {
  if (process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Set ALLOW_DEMO_SEED=true on an isolated demo database.');
  const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Demo seeding requires a loopback APP_ORIGIN.');
  const departureDate = localDate(7);
  const flightDate = new Date(`${departureDate}T00:00:00.000Z`);
  const inputs = [
    {flight: demoFlight, name: `${demoBooking.firstName} ${demoBooking.surname}`, email: 'aanya@example.test', alias: 'Traveller AS01', baggage: {allowance: 15, expected: 12}, pickupArea: 'Dwarka, Delhi', freeSeats: 2, welcome: true},
    {flight: demoFlight, name: 'Arjun Mehta', email: 'arjun@example.test', alias: 'Traveller AM02', baggage: {allowance: 15, expected: 17}},
    {flight: demoFlight, name: 'Priya Iyer', email: 'priya@example.test', alias: 'Traveller PI03', baggage: {allowance: 15, expected: 11}, anonymous: true},
    {flight: nearbyDemoFlight, name: 'Rohan Rao', email: 'rohan@example.test', alias: 'Traveller RR04', pickupArea: 'Connaught Place, Delhi', freeSeats: 3, partySize: 2},
  ];
  await prisma.$transaction(async (tx) => {
    for (const person of inputs) {
      const instanceKey = flightKey({...person.flight, departureDate});
      const room = await tx.flight.upsert({where: {instanceKey}, create: {...person.flight, departureDate: flightDate, instanceKey}, update: {}});
      const user = await tx.user.upsert({where: {email: person.email}, create: {email: person.email, emailVerified: new Date()}, update: {}});
      await tx.passengerProfile.upsert({where: {userId: user.id}, create: {userId: user.id, displayName: person.name, isAnonymous: person.anonymous ?? false, companionship: true}, update: {}});
      const membership = await tx.flightMembership.upsert({where: {flightId_userId: {flightId: room.id, userId: user.id}}, create: {
        flightId: room.id, userId: user.id, alias: person.alias, verificationStatus: 'MOCK', partySize: person.partySize ?? 1,
        baggageReported: !!person.baggage, baggageAllowance: person.baggage?.allowance ?? 0, expectedBaggageWeight: person.baggage?.expected ?? 0,
      }, update: {}});
      await tx.verificationRecord.upsert({where: {userId_flightId: {flightId: room.id, userId: user.id}}, create: {userId: user.id, flightId: room.id, verificationMethod: 'DEMO_SEED', verificationStatus: 'MOCK'}, update: {}});
      if (person.pickupArea && person.freeSeats && membership.isActive && membership.verificationStatus === 'MOCK' &&
          !await tx.cabListing.findFirst({where: {hostMembershipId: membership.id}, select: {id: true}})) {
        await tx.cabListing.create({data: {hostMembershipId: membership.id, pickupArea: person.pickupArea, freeSeats: person.freeSeats}});
      }
      if (person.welcome) await tx.flightGroupMessage.upsert({
        where: {flightId_senderId_clientId: {flightId: room.id, senderId: user.id, clientId: 'demo-welcome-v2'}},
        create: {flightId: room.id, senderId: user.id, clientId: 'demo-welcome-v2', content: 'Welcome to the demo flight! We can use this chat to share general travel tips. Check your airline for official updates.'}, update: {},
      });
    }
  });
  console.log(`Seeded fictional ${demoFlight.airline} ${demoFlight.flightNumber} and ${nearbyDemoFlight.airline} ${nearbyDemoFlight.flightNumber} development rooms for ${departureDate}.`);
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Demo data could not be seeded.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());