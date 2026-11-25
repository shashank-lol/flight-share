# Flight Share REST API v1

Endpoints are relative to `/api/v1` unless otherwise noted. Ordinary successful responses use `{"data": ...}`; errors use `{"error":{"code":"...","message":"..."}}`, with an optional request ID for internal errors. Respect `401` (sign-in required), `403` (invalid origin), `404` (missing or inaccessible), `409` (state conflict), `422` (flight provider cannot verify), and `429` (rate limit). Responses are not cacheable. Public health endpoints are outside `/api/v1`: `/api/health` returns `{"status":"ok"}`; `/api/health?ready=1` returns `{"status":"ready"}` or HTTP 503 with `{"status":"not_ready"}`.

## Authentication

Clients start a browser-bound guest session without email and use the returned session cookie on subsequent requests. Browsers should use same-origin requests and let the browser manage the cookie; non-browser clients must send the configured `APP_ORIGIN` as `Origin` on mutations. JSON requests require `Content-Type: application/json` and a body no larger than 16 KiB. Do not send session tokens in URLs.

| Method and path | Request and result |
| --- | --- |
| `POST /auth/guest` | `{}` returns `{id}` and sets a seven-day session cookie. Reuses a valid session and rate-limits new guest creation by IP. |
| `POST /auth/logout` | Revokes the active session and clears its cookie; returns `{signedOut:true}`. Guests cannot recover access after revocation. |

## Profile and flights

| Method and path | Request and result |
| --- | --- |
| `GET /profile` | `{profile,flights,flyer}` for the current session; `profile` is null until the first flight is joined. |
| `PATCH /profile` | Update the supplied profile fields; returns the updated profile. |
| `DELETE /profile` | Deletes the account, clears the session cookie and returns `{deleted:true}`. |
| `GET /flights/options` | Public. `{mockBookingEnabled}` indicates whether the local mock provider is allowed. |
| `POST /flights/verify` | Manual: `{method:"manual",airline,flightNumber,departureAirport,arrivalAirport,departureDate,departureTime?}`. Demo only: `{method:"pnr",pnr:"DEMO12",surname:"Sharma",departureDate?}`. Returns `{token,flight,verificationStatus,suggestedDisplayName?}`. Use the token within ten minutes; it is scoped to the current user and single-use. |
| `POST /flights/join` | `{token,displayName,partySize?,...profileOptions}`. Returns `{id}` (flight UUID). Also accepts optional `baggageAllowance` and `expectedBaggageWeight` as a pair, with optional `cabinBaggage`. |
| `GET /flights/search?code=6E203&date=YYYY-MM-DD` | `{items:[{flight,source}],liveEnabled,liveError}`. Sources are `SCHEDULE`, `COMMUNITY`, and local `DEMO`. No booking or passenger lookup. |
| `GET /flights/{flightId}` | Flight summary and the caller's `membership` record. Requires active membership. |
| `DELETE /flights/{flightId}/leave` | Ends membership; returns `{left:true}`. |
| `GET /flights/{flightId}/passengers` | A membership-scoped directory page `{items,page,hasMore}`. Filters `all`, `cab`, `companions`; sorts `recent`, `name`; optional `q` and `page` query parameters. |

Flight date is local to the departure airport and uses `YYYY-MM-DD`; optional time uses `HH:mm`. Airport codes are three letters. Manual entries have status `SELF_REPORTED`; local demo bookings have status `MOCK`. The fictional demo flight is 6E203, DEL → BOM at 08:25 local time. Neither status confirms boarding eligibility. Profile options are `isAnonymous`, `showBaggage`, `showTravelPreferences`, `companionship`, `showFlyer` (booleans), and `transportation` (`NONE`, `CAB_SHARE`, `PUBLIC_TRANSIT`, or `OWN_RIDE`). `displayName` is required when joining. `partySize` is 1–12 total and defaults to 1. Passenger directory `id` is the passenger's **membership ID**, not the user's account ID; use it when choosing a passenger in that flight. The flight room summary and passenger directory do not include baggage estimates. Hidden travel preferences return `null` in the directory.

## Conversations, notifications and safety

| Method and path | Request and result |
| --- | --- |
| `POST /flights/{flightId}/conversations` | `{passengerId}` opens or retrieves the unique conversation for the pair and adds this shared flight as a context. Accepted baggage and cab requests reuse the same pair conversation. |
| `GET /conversations` | `{items,page,hasMore}`, optionally filtered by `flightId`; accepts `page`. |
| `GET /conversations/{id}` | Conversation metadata, active `contexts`, participant (name or alias), unread count and last message. |
| `GET /conversations/{id}/messages` | `{items,page,hasMore,nextCursor}`; accepts `page` or `cursor`; newest first. |
| `POST /conversations/{id}/messages` | `{clientId,content}`; sends plain text up to 2,000 characters. Retry with the same `clientId` and text to avoid duplicate delivery. |
| `PATCH /conversations/{id}/read` | Optional `{messageId}` marks incoming messages as read through that message; returns `{updated}`. |
| `GET /notifications` | `{items,page,hasMore,unreadCount}`; accepts `page`. |
| `PATCH /notifications/read` | Marks visible notifications as read; returns `{updated}`. |
| `PATCH /notifications/{id}/read` | Marks one visible notification as read. |
| `POST /flights/{flightId}/block` | `{passengerId}` blocks interaction in both directions; returns `{blocked:true}`. |
| `POST /flights/{flightId}/report` | `{passengerId,reason,description?}` records a report and returns `{id,status}`. |
| `POST /conversations/{id}/block` | `{}` blocks the chat partner, including cross-flight partners. |
| `POST /conversations/{id}/report` | `{reason,description?}` reports the chat partner. |
| `GET /blocks` | Lists the caller's blocked passengers without exposing account IDs. |
| `DELETE /blocks/{id}` | Removes the caller's block; returns `{unblocked:true}`. |

The Socket.IO connection uses the same origin and session cookie. `flight:updated`, `conversation:updated`, `conversations:updated`, and `notification:new` are invalidation signals; fetch current data from REST on those events and on reconnection. Message writes and read receipts are persisted through REST; Socket.IO delivery is not the system of record.

`conversation:presence` accepts `{conversationId}` and acknowledges `{ok,online?}`. `conversation:typing` accepts `{conversationId,typing}` and publishes the same shape to the other authorized participant only. Presence and typing are ephemeral and subject to active membership, blocks, and rate limits. The client clears stale typing hints locally.

## Cab listings and requests

| Method and path | Request and result |
| --- | --- |
| `GET /flights/{flightId}/rides?window=20&page=1` | `{items,page,hasMore,eligibility,window,ownListing}`. `window` is an integer 0–60, default 20. `eligibility` is `READY`, `MISSING_TIME`, or `EXPIRED`. |
| `POST /flights/{flightId}/rides` | `{pickupArea,freeSeats}` publishes a cab listing and returns its ID and seat counts. One open listing per membership. |
| `PATCH /flights/{flightId}/rides/{listingId}` | `{pickupArea,freeSeats}` edits the host's listing. The total cannot drop below the number of accepted seats. |
| `DELETE /flights/{flightId}/rides/{listingId}` | Closes the host's listing and its pending requests; returns `{closed:true}`. Existing accepted riders can still use the private chat while authorised. |
| `POST /flights/{flightId}/rides/{listingId}/requests` | `{seats?,window?}` from the requester's own flight. Defaults to their party size and a 20-minute window. Returns `{id,seats,status,conversationId}`. |
| `GET /flights/{flightId}/ride-requests?direction=received&page=1` | `{items,direction,page,hasMore}`. `direction` is `received` (default) or `sent`. |
| `PATCH /flights/{flightId}/ride-requests/{requestId}` | `{action}`: host `accept` or `decline`, requester `withdraw`. Returns `{id,seats,status,conversationId}`. |
| `GET` or `POST` `/conversations/{id}/ride-completion?contextId={contextId}` | `{available,confirmedByMe,confirmedByBoth}`. Optional `contextId` selects a ride context. `POST` records the caller's confirmation after the departure day; both confirmations are required to count the ride. |

Browsing and posting require active flight membership and a current scheduled departure time. Search compares departures from the same airport using the local flight dates and times (including across midnight), not pickup times. No listing is required to browse or request seats. Use a general pickup area such as `Dwarka, Delhi`, not an exact address, and offer 1–12 seats. Pending requests do not reserve seats; host acceptance rechecks capacity and opens or reuses the pair's private chat. This does not give either traveller access to the other's flight room. `showFlyer` controls whether a host's flyer activity appears on their listings.

## Baggage matches

| Method and path | Request and result |
| --- | --- |
| `GET /profile/baggage?flightId={flightId}` | Returns the caller's `{baggageReported,baggageAllowance,expectedBaggageWeight,cabinBaggage}`. |
| `PATCH /profile/baggage` | `{flightId,baggageAllowance?,expectedBaggageWeight?,cabinBaggage?}` with at least one change; returns the caller's updated baggage values. |
| `GET /flights/{flightId}/matches?page=1` | `{items,requests,disclaimer,page,hasMore,baggage,eligibility}`. `baggage` contains the caller's values. `items` contains compatible, visible estimates for the same flight. |
| `POST /flights/{flightId}/baggage-requests` | `{passengerId}` requests a match. A reciprocal request accepts the pending match. Returns `{id,status,conversationId}`. |
| `PATCH /flights/{flightId}/baggage-requests/{requestId}` | `{action}`: recipient `accept` or `decline`, sender `withdraw`, either party `end` an accepted match. Returns `{id,status,conversationId}`. |
| `GET /flights/{flightId}/policy` | `{status,summary,restrictions}`. Status is currently `UNKNOWN`. |

Baggage weights are 0–250 kg with up to two decimal places. Requests and confirmed matches are visible only to the pair. Each membership may have one confirmed match; confirmation cancels other pending requests involving either participant. Ending a match allows both travellers to match again if eligible, without deleting the private chat. Blocking or leaving ends the match. A match is a weight comparison, not permission to pool allowance or carry others' belongings.

## Flight group chat

| Method and path | Request and result |
| --- | --- |
| `GET /flights/{flightId}/group-messages` | Members-only history, including messages sent before the caller joined. Supports cursor pagination and excludes blocked senders. |
| `POST /flights/{flightId}/group-messages` | `{clientId,content}` persists a plain-text message. Retry with the same ID and text. Clients refresh on `group:updated` and reconnect. |

Never put an exact address or booking reference in profile fields or group chat.