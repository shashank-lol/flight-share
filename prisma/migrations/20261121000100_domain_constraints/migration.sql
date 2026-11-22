ALTER TABLE "FlightMembership" ADD CONSTRAINT "FlightMembership_weight_bounds" CHECK (
    "baggageAllowance" BETWEEN 0 AND 250 AND "expectedBaggageWeight" BETWEEN 0 AND 250
);
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_distinct_airports" CHECK ("departureAirport" <> "arrivalAirport");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_canonical_participants" CHECK ("participantOneId" COLLATE "C" < "participantTwoId" COLLATE "C");
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_distinct_users" CHECK ("blockerId" <> "blockedId");
ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_distinct_users" CHECK ("reporterId" <> "reportedUserId");