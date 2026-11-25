BEGIN;

CREATE TABLE "ConversationContext" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "flightOneId" TEXT NOT NULL,
  "flightTwoId" TEXT NOT NULL,
  "ride" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationContext_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConversationContext_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationContext_flightOneId_fkey" FOREIGN KEY ("flightOneId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationContext_flightTwoId_fkey" FOREIGN KEY ("flightTwoId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConversationContext_cross_flight_ride" CHECK ("ride" OR "flightOneId" = "flightTwoId")
);
CREATE UNIQUE INDEX "ConversationContext_conversationId_flightOneId_flightTwoId_key" ON "ConversationContext"("conversationId", "flightOneId", "flightTwoId");
CREATE INDEX "ConversationContext_flightOneId_idx" ON "ConversationContext"("flightOneId");
CREATE INDEX "ConversationContext_flightTwoId_idx" ON "ConversationContext"("flightTwoId");

-- Keep the oldest conversation ID for each canonical pair. Capture every original
-- authorization, including inactive ones, before consolidating the threads.
CREATE TEMP TABLE "ConversationMerge" ON COMMIT DROP AS
SELECT c.id AS "oldId",
  first_value(c.id) OVER (PARTITION BY c."participantOneId", c."participantTwoId" ORDER BY c."createdAt", c.id) AS "newId",
  c."flightId" AS "flightOneId", COALESCE(c."rideFlightId", c."flightId") AS "flightTwoId",
  c."rideFlightId" IS NOT NULL AS "ride", c."createdAt"
FROM "Conversation" c;
ALTER TABLE "ConversationMerge" ADD PRIMARY KEY ("oldId");

INSERT INTO "ConversationContext" ("id", "conversationId", "flightOneId", "flightTwoId", "ride", "createdAt")
SELECT min("oldId"), "newId", "flightOneId", "flightTwoId", bool_or("ride"), min("createdAt")
FROM "ConversationMerge"
GROUP BY "newId", "flightOneId", "flightTwoId";

-- A passenger could reuse one client ID in different old threads. Preserve all
-- message rows and their ordering/read receipts; only rename colliding keys.
-- '~legacy:' is reserved because it is outside the HTTP client ID alphabet.
WITH ranked AS (
  SELECT m.id, row_number() OVER (PARTITION BY map."newId", m."senderId", m."clientId"
    ORDER BY (m."conversationId" = map."newId") DESC, m."createdAt", m.id) AS rank
  FROM "Message" m JOIN "ConversationMerge" map ON map."oldId" = m."conversationId"
)
UPDATE "Message" m SET "clientId" = '~legacy:' || m.id FROM ranked WHERE m.id = ranked.id AND ranked.rank > 1;

UPDATE "Message" m SET "conversationId" = map."newId" FROM "ConversationMerge" map
WHERE m."conversationId" = map."oldId" AND map."newId" <> map."oldId";

UPDATE "Notification" n SET "payload" = jsonb_set(n."payload", '{conversationId}', to_jsonb(map."newId"))
FROM "ConversationMerge" map WHERE n."payload"->>'conversationId' = map."oldId" AND map."newId" <> map."oldId";

-- Anchor both confirmations to the exact ride context, not just the user pair.
ALTER TABLE "RideConfirmation" ADD COLUMN "contextId" TEXT;
UPDATE "RideConfirmation" r SET "contextId" = ctx.id
FROM "ConversationMerge" map JOIN "ConversationContext" ctx
  ON ctx."conversationId" = map."newId" AND ctx."flightOneId" = map."flightOneId" AND ctx."flightTwoId" = map."flightTwoId"
WHERE r."conversationId" = map."oldId";

-- Normally legacy ride scopes were unique per flight pair. If two legacy rows
-- still map to one context, keep the earliest confirmation for each passenger.
WITH ranked AS (
  SELECT "conversationId", "userId", row_number() OVER (PARTITION BY "contextId", "userId" ORDER BY "createdAt", "conversationId") AS rank
  FROM "RideConfirmation"
)
DELETE FROM "RideConfirmation" r USING ranked
WHERE r."conversationId" = ranked."conversationId" AND r."userId" = ranked."userId" AND ranked.rank > 1;

ALTER TABLE "RideConfirmation"
  DROP CONSTRAINT "RideConfirmation_pkey",
  DROP COLUMN "conversationId",
  ALTER COLUMN "contextId" SET NOT NULL,
  ADD CONSTRAINT "RideConfirmation_pkey" PRIMARY KEY ("contextId", "userId"),
  ADD CONSTRAINT "RideConfirmation_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "ConversationContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DELETE FROM "Conversation" c USING "ConversationMerge" map WHERE c.id = map."oldId" AND map."newId" <> map."oldId";
ALTER TABLE "Conversation" DROP COLUMN "scopeKey", DROP COLUMN "flightId", DROP COLUMN "rideFlightId";
DROP INDEX "Conversation_participantOneId_idx";
CREATE UNIQUE INDEX "Conversation_participantOneId_participantTwoId_key" ON "Conversation"("participantOneId", "participantTwoId");

COMMIT;