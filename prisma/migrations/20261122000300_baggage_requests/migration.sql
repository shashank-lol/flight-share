CREATE TYPE "BaggageRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CANCELLED', 'ENDED');

CREATE UNIQUE INDEX "FlightMembership_id_flightId_key" ON "FlightMembership"("id", "flightId");

CREATE TABLE "BaggageRequest" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "senderMembershipId" TEXT NOT NULL,
    "recipientMembershipId" TEXT NOT NULL,
    "status" "BaggageRequestStatus" NOT NULL DEFAULT 'PENDING',
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BaggageRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BaggageRequest_distinct_memberships" CHECK ("senderMembershipId" <> "recipientMembershipId"),
    CONSTRAINT "BaggageRequest_senderMembershipId_flightId_fkey" FOREIGN KEY ("senderMembershipId", "flightId") REFERENCES "FlightMembership"("id", "flightId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BaggageRequest_recipientMembershipId_flightId_fkey" FOREIGN KEY ("recipientMembershipId", "flightId") REFERENCES "FlightMembership"("id", "flightId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BaggageRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BaggageRequest_senderMembershipId_status_idx" ON "BaggageRequest"("senderMembershipId", "status");
CREATE INDEX "BaggageRequest_recipientMembershipId_status_idx" ON "BaggageRequest"("recipientMembershipId", "status");
CREATE INDEX "BaggageRequest_conversationId_idx" ON "BaggageRequest"("conversationId");
CREATE UNIQUE INDEX "BaggageRequest_one_open_pair" ON "BaggageRequest" (
    LEAST("senderMembershipId", "recipientMembershipId"),
    GREATEST("senderMembershipId", "recipientMembershipId")
) WHERE "status" IN ('PENDING', 'ACCEPTED');

-- A membership can be reserved only once, even when accepting in opposite request directions.
CREATE TABLE "BaggageReservation" (
    "membershipId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    CONSTRAINT "BaggageReservation_pkey" PRIMARY KEY ("membershipId"),
    CONSTRAINT "BaggageReservation_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FlightMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BaggageReservation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "BaggageRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BaggageReservation_requestId_idx" ON "BaggageReservation"("requestId");