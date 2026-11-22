# Security and privacy

## Identity and access

- Guest sessions do not collect an email or establish identity or boarding eligibility. Access lasts up to seven days and cannot be recovered after revocation, expiration, clearing cookies, or switching browser profiles. Expiration does not delete data; operators need a retention process. Existing accounts are retained by the migration but no email login route remains.
- Sessions use opaque, server-validated tokens with an `HttpOnly`, `SameSite=Lax` cookie and `Secure` on HTTPS. Only session token digests are stored in PostgreSQL. Guest creation and flight searches have IP rate limits.
- Authenticated writes require the configured origin. The API validates incoming fields and applies rate limits to sensitive operations. Do not expose the app upstream when trusting proxy headers.
- Flight and social reads and writes are scoped to membership and, for conversations, participants. Blocks apply in both directions for interaction. A Socket.IO connection is not a substitute for resource authorization.

## Data shared in a flight room

Fellow members can see a traveler's display name or anonymous per-flight alias and the baggage and travel preferences they choose to make visible. Messages and notifications are not public, but new guests can join a flight room on self-reported details. Do not place contact, booking, payment or other sensitive details in messages, profile fields, or reports unnecessarily.

Manual flight data is self-reported, and mock bookings are demonstration data. There is no live booking verification configured and the app does not persist a raw PNR or booking surname. Supported pasted ticket text is parsed in the browser; only reviewed itinerary fields and a chosen display name are submitted. The optional AeroDataBox lookup receives only a flight code and date. Do not submit real booking details into the local mock flow. The match calculator compares weights only: policy status remains `UNKNOWN` until an authorized airline policy integration has been reviewed. Only the airline can confirm what is permitted. Keep your bags under your control and never carry items for another traveller.

Ride discovery requires per-flight opt-in from both accounts. A matching rider may see your display name or alias, party size, scheduled departure, optional coarse pickup area, and optional flyer activity. A match is not a booking or a safety check. Do not enter an exact address as a pickup area. Community messages are visible to active flight-room members, including members who join after a message was sent. Ride chats do not grant access to each other's flight rooms. Flyer points and mutual confirms are app activity only, not verified travel or evidence of identity.

## Operating the service

Use private deployment secrets, HTTPS and authenticated data stores. Restrict who can view logs, backups, messages and reports. Do not send credentials, raw session cookies or private content to analytics or error-reporting services. Set a retention and deletion process for production data and backups, and assign someone to handle reports and support requests. The drafts linked on the site are not production policy; see the [deployment checklist](deployment.md#before-public-launch).