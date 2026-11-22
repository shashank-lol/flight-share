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
| `PATCH /profile/baggage` | `{flightId,baggageAllowance?,expectedBaggageWeight?,cabinBaggage?}` with at least one change; returns updated flight room data. |
| `GET /flights/options` | Public. `{mockBookingEnabled}` indicates whether the local mock provider is allowed. |
| `POST /flights/verify` | Manual: `{method:"manual",airline,flightNumber,departureAirport,arrivalAirport,departureDate,departureTime?}`. Demo only: `{method:"pnr",pnr:"DEMO12",surname:"Traveller",departureDate?}`. Returns `{token,flight,verificationStatus}`. Use the token within ten minutes; it is scoped to the current user and single-use. |
| `POST /flights/join` | `{token,displayName,baggageAllowance,expectedBaggageWeight,cabinBaggage?,...profileOptions}`. Returns `{id}` (flight UUID). |
| `GET /flights/{flightId}` | Flight summary and the caller's `membership` record. Requires active membership. |
| `DELETE /flights/{flightId}/leave` | Ends membership; returns `{left:true}`. |
| `GET /flights/{flightId}/passengers` | A membership-scoped directory page `{items,page,hasMore}`. Filters `all`, `excess`, `available`, `cab`, `companions`; sorts `recent`, `name`, `baggage`; optional `q` and `page` query parameters. |
| `GET /flights/{flightId}/matches` | `{items,disclaimer,page,hasMore}`. Only visible, compatible balances are considered. Optional `page` query. |
| `GET /flights/{flightId}/policy` | `{status,summary,restrictions}`. Status is currently `UNKNOWN`. |

Flight date is local to the departure airport and uses `YYYY-MM-DD`; optional time uses `HH:mm`. Airport codes are three letters. The manually supplied flight result has status `SELF_REPORTED`; the demo result is `MOCK`. Neither confirms boarding eligibility. Baggage values are numbers in kilograms with up to two decimal places, bounded from 0 to 250. Profile options are `isAnonymous`, `showBaggage`, `showTravelPreferences`, `companionship` (booleans), and `transportation` (`NONE`, `CAB_SHARE`, `PUBLIC_TRANSIT`, or `OWN_RIDE`). `displayName` is required when joining. Passenger directory `id` is the passenger's **membership ID**, not the user's account ID; use it when choosing a passenger in that flight. Hidden baggage and travel details return `null` in the directory. A `POTENTIAL` match is a weight comparison, never permission to pool allowance or carry others' belongings.

## Conversations, notifications and safety

| Method and path | Request and result |
| --- | --- |
| `POST /flights/{flightId}/conversations` | `{passengerId}` opens or retrieves the unique conversation for both active travellers. |
| `GET /conversations` | `{items,page,hasMore}`, optionally filtered by `flightId`; accepts `page`. |
| `GET /conversations/{id}` | Conversation metadata, anonymized participant, unread count and last message. |
| `GET /conversations/{id}/messages` | `{items,page,hasMore}`; accepts `page`; newest first. |
| `POST /conversations/{id}/messages` | `{clientId,content}`; sends plain text up to 2,000 characters. Retry with the same `clientId` and text to avoid duplicate delivery. |
| `PATCH /conversations/{id}/read` | Optional `{messageId}` marks incoming messages as read through that message; returns `{updated}`. |
| `GET /notifications` | `{items,page,hasMore,unreadCount}`; accepts `page`. |
| `PATCH /notifications/read` | Marks visible notifications as read; returns `{updated}`. |
| `PATCH /notifications/{id}/read` | Marks one visible notification as read. |
| `POST /flights/{flightId}/block` | `{passengerId}` blocks interaction in both directions; returns `{blocked:true}`. |
| `POST /flights/{flightId}/report` | `{passengerId,reason,description?}` records a report and returns `{id,status}`. |
| `GET /blocks` | Lists the caller's blocked passengers without exposing account IDs. |
| `DELETE /blocks/{id}` | Removes the caller's block; returns `{unblocked:true}`. |

The Socket.IO connection uses the same origin and session cookie. `flight:updated`, `conversation:updated`, `conversations:updated`, and `notification:new` are invalidation signals; fetch current data from REST on those events and on reconnection. Message writes and read receipts are persisted through REST; Socket.IO delivery is not the system of record.

`conversation:presence` accepts `{conversationId}` and acknowledges `{ok,online?}`. `conversation:typing` accepts `{conversationId,typing}` and publishes the same shape to the other authorized participant only. Presence and typing are ephemeral and subject to active membership, blocks, and rate limits. The client clears stale typing hints locally.

## Travel community

| Method and path | Request and result |
| --- | --- |
| `GET /flights/search?code=BA117&date=YYYY-MM-DD` | `{items:[{flight,source}],liveEnabled,liveError}`. Sources are `SCHEDULE`, `COMMUNITY`, and local `DEMO`. No booking or passenger lookup. |
| `GET /flights/{flightId}/rides?page=1` | `{items,page,hasMore,eligibility}`; members must opt in and have a scheduled departure time. Matching uses the same departure airport and a ±20-minute window on the airport's local calendar, including midnight. |
| `PATCH /flights/{flightId}/ride-settings` | `{partySize,rideOptIn,pickupArea?,departureTime?}`; optional `departureTime` only fills a previously missing time. |
| `POST /flights/{flightId}/ride-conversations` | `{passengerId}` opens a private ride chat if both memberships still qualify. Does not grant access to the other flight room. |
| `GET` or `POST /conversations/{id}/ride-completion` | `{available,confirmedByMe,confirmedByBoth}`. `POST` records the caller's confirmation after the departure day. Only two confirmations count as a shared ride. |
| `GET /flights/{flightId}/group-messages` | Members-only history, including messages sent before the caller joined. Supports cursor pagination and excludes blocked senders. |
| `POST /flights/{flightId}/group-messages` | `{clientId,content}` persists a plain-text message. Retry with the same ID/text. Clients refresh on `group:updated` and reconnect. |

Join accepts `partySize` (1–12 total, default 1), `rideOptIn` (default false), and optional coarse `pickupArea`. Baggage weights are optional as a pair. `GET /profile` returns the account's `flyer` activity. Profile preference `showFlyer` controls exposure to eligible ride partners. Never put an exact address or booking reference in profile fields or group chat.