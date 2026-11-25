-- Old ride preferences were never a published listing; don't turn them into public posts.
DROP INDEX "FlightMembership_flightId_rideOptIn_isActive_idx";
ALTER TABLE "FlightMembership" DROP COLUMN "rideOptIn", DROP COLUMN "pickupArea";

CREATE TYPE "CabRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CLOSED');

CREATE TABLE "CabListing" (
    "id" TEXT NOT NULL,
    "hostMembershipId" TEXT NOT NULL,
    "pickupArea" TEXT NOT NULL,
    "freeSeats" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CabListing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CabListing_free_seats" CHECK ("freeSeats" BETWEEN 1 AND 12)
);

CREATE TABLE "CabRequest" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "riderMembershipId" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "window" INTEGER NOT NULL,
    "status" "CabRequestStatus" NOT NULL DEFAULT 'PENDING',
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CabRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CabRequest_seats" CHECK ("seats" BETWEEN 1 AND 12),
    CONSTRAINT "CabRequest_window" CHECK ("window" BETWEEN 0 AND 60)
);

CREATE INDEX "CabListing_hostMembershipId_idx" ON "CabListing"("hostMembershipId");
CREATE UNIQUE INDEX "CabListing_one_open_per_membership" ON "CabListing"("hostMembershipId") WHERE "closedAt" IS NULL;
CREATE UNIQUE INDEX "CabRequest_listingId_riderMembershipId_key" ON "CabRequest"("listingId", "riderMembershipId");
CREATE INDEX "CabRequest_listingId_status_idx" ON "CabRequest"("listingId", "status");
CREATE INDEX "CabRequest_riderMembershipId_createdAt_idx" ON "CabRequest"("riderMembershipId", "createdAt");
CREATE INDEX "CabRequest_conversationId_idx" ON "CabRequest"("conversationId");
ALTER TABLE "CabListing" ADD CONSTRAINT "CabListing_hostMembershipId_fkey" FOREIGN KEY ("hostMembershipId") REFERENCES "FlightMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabRequest" ADD CONSTRAINT "CabRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "CabListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabRequest" ADD CONSTRAINT "CabRequest_riderMembershipId_fkey" FOREIGN KEY ("riderMembershipId") REFERENCES "FlightMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CabRequest" ADD CONSTRAINT "CabRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;