ALTER TABLE "PassengerProfile" ADD COLUMN "showFlyer" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "FlightMembership" ADD COLUMN "baggageReported" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "partySize" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "rideOptIn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pickupArea" TEXT, ADD CONSTRAINT "FlightMembership_party_size" CHECK ("partySize" BETWEEN 1 AND 12);

ALTER TABLE "Conversation" ADD COLUMN "rideFlightId" TEXT, ADD COLUMN "scopeKey" TEXT;
UPDATE "Conversation" SET "scopeKey" = "flightId" || ':' || "participantOneId" || ':' || "participantTwoId";
ALTER TABLE "Conversation" ALTER COLUMN "scopeKey" SET NOT NULL;
DROP INDEX "Conversation_flightId_participantOneId_participantTwoId_key";
CREATE UNIQUE INDEX "Conversation_scopeKey_key" ON "Conversation"("scopeKey");
CREATE INDEX "Conversation_flightId_idx" ON "Conversation"("flightId");
CREATE INDEX "Conversation_rideFlightId_idx" ON "Conversation"("rideFlightId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_rideFlightId_fkey" FOREIGN KEY ("rideFlightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Flight_departureAirport_departureDate_idx" ON "Flight"("departureAirport", "departureDate");
CREATE INDEX "Flight_airline_flightNumber_departureDate_idx" ON "Flight"("airline", "flightNumber", "departureDate");
CREATE INDEX "FlightMembership_flightId_rideOptIn_isActive_idx" ON "FlightMembership"("flightId", "rideOptIn", "isActive");

CREATE TABLE "FlightGroupMessage" (
  "id" TEXT PRIMARY KEY, "flightId" TEXT NOT NULL, "senderId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL, "content" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FlightGroupMessage_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FlightGroupMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FlightGroupMessage_flightId_senderId_clientId_key" ON "FlightGroupMessage"("flightId", "senderId", "clientId");
CREATE INDEX "FlightGroupMessage_flightId_createdAt_id_idx" ON "FlightGroupMessage"("flightId", "createdAt", "id");
CREATE INDEX "FlightGroupMessage_senderId_idx" ON "FlightGroupMessage"("senderId");

CREATE TABLE "RideConfirmation" (
  "conversationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RideConfirmation_pkey" PRIMARY KEY ("conversationId", "userId"),
  CONSTRAINT "RideConfirmation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RideConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RideConfirmation_userId_idx" ON "RideConfirmation"("userId");