ALTER TABLE "Flight"
  ADD COLUMN "scheduledArrivalAt" TIMESTAMPTZ(3),
  ADD COLUMN "estimatedArrivalAt" TIMESTAMPTZ(3),
  ADD COLUMN "landedAt" TIMESTAMPTZ(3),
  ADD COLUMN "arrivalCheckedAt" TIMESTAMPTZ(3);