export const policies = {
  privacy: {
    title: "Privacy notice",
    intro: "Here’s what you enter in Flight Share, what other travellers may see, and what you can control.",
    sections: [
      { title: "Information you provide", text: "Guest access doesn’t ask for an email. Flight Share keeps a session cookie in this browser and uses your IP address to limit abuse. We store your profile, flight-room memberships, travel preferences, baggage estimates, cab listings, requests, messages, ride confirmations, blocks and reports." },
      { title: "What cab listings and seat requests show", text: "An open cab listing shows your display name or alias, flight number, departure date and time, general pickup area and available seat count to eligible travellers. They can be on other flights. If you request seats, the host can see your display name or alias, flight number and requested seat count." },
      { title: "Baggage matches", text: "When your baggage details are visible, compatible travellers on your exact flight may see your display name or alias and estimated excess or spare weight in Baggage matches. Requests and confirmed matches are only visible to the two travellers involved." },
      { title: "Direct messages and flight group chat", text: "An accepted seat request or baggage match can open a private chat between the two travellers. In a flight room’s group chat, eligible members can see your display name or alias and your posts, including people who join later. Sharing a cab does not give anyone access to another flight’s group chat. Flight Share stores messages, and recipients may save or forward what you send." },
      { title: "Profile and flyer progress visibility", text: "Members of your flight room may see your display name or alias and the travel preferences you choose to show. Your profile setup progress isn’t visible to others. Cab listings you publish can show your flyer tier, points and activity counts by default. You can turn this off in profile settings. Flyer progress doesn’t verify your identity, ticket or boarding status." },
      { title: "Your controls", text: "You can adjust profile visibility, close your cab listing, block or report travellers, and delete your account. An alias changes what fellow travellers see; it does not hide your account from the service. Leaving a room, clearing cookies, or losing your guest session does not itself erase stored information. Guest access cannot be recovered." },
      { title: "Sensitive information", text: "Don’t put your passport, booking reference, boarding pass, payment details, or other sensitive identifying information in your profile or messages." },
    ],
  },
  terms: {
    title: "Terms of use",
    intro: "Flight Share helps travellers coordinate before a trip. It isn’t an airline, a ticketing service, or a transportation provider.",
    sections: [
      { title: "Flight rooms are for coordination", text: "Guests can join rooms using self-reported flight details. A room membership or published schedule does not confirm someone’s identity, reservation, or boarding status. Check your airline’s official information before relying on any flight or baggage details." },
      { title: "Rides to the departure airport", text: "Travellers can post cab listings and request seats using an adjustable search window for flights from the same departure airport. A host must accept a request before seats are reserved on the listing. Travellers agree on pickup, timing, terminal drop-off and costs themselves. Flight Share doesn’t book, provide, or take payment for transportation." },
      { title: "Same-flight baggage matching", text: "Only travellers on the exact same flight can request a baggage match. Both must agree to confirm it. A confirmed match does not transfer allowance or authorise pooling. Only consider pooling if your airline permits it for your booking and bags. Pack and carry only your own belongings; don’t transport anyone else’s items." },
      { title: "Respect others’ privacy", text: "Cab listings make selected trip and pickup details visible to eligible travellers. Use a general area, not an exact address. Flight group chat posts can be read by eligible members, including those who join later. Don’t repost another traveller’s messages, pickup details or profile information without permission." },
      { title: "Use the service respectfully", text: "Provide accurate travel details, respect other travellers’ choices, and don’t use the service to harass, impersonate, solicit payments, or share someone else’s personal information without permission." },
    ],
  },
  contact: {
    title: "Contact",
    intro: "Where to go for account help, traveller safety, and questions about your trip.",
    sections: [
      { title: "Get help with this deployment", text: "There is no public support address supplied for this demo. Use the contact details given to you by the operator of the deployment for account, privacy, or accessibility questions." },
      { title: "Report a traveller", text: "Use the report option in Flight Share for concerns about another traveller. For immediate help, contact airport staff, the flight crew, or local emergency services rather than waiting for a report response." },
      { title: "Contact your airline for flight questions", text: "Your airline can help with bookings, flight changes, baggage rules, and boarding. Flight Share can’t modify a reservation or approve a baggage arrangement." },
    ],
  },
  community: {
    title: "Community guidelines",
    intro: "A good flight room makes it easy to say hello and just as easy to say no. Help keep it that way.",
    sections: [
      { title: "Respect a no, including no reply", text: "No one owes you a conversation, a ride, or an in-person meet-up. Don’t repeatedly contact someone who doesn’t respond or pressure them into an arrangement." },
      { title: "Be honest and don’t ask for sensitive details", text: "Don’t impersonate another traveller or an airline representative. Don’t ask for money, booking codes, boarding passes, or identity documents. Harassment, threats, hate, and scams don’t belong here." },
      { title: "Meet on your own terms", text: "Keep early conversations in the app. Start with a general pickup area, then choose a public meeting spot if you decide to ride together. Don’t share someone else’s pickup details. Pack and carry only your own belongings." },
      { title: "Block, report, or get help where you are", text: "Use the in-app block and report controls if someone makes you uncomfortable or breaks these guidelines. A report is not an emergency call. If you feel unsafe at an airport or on board, contact airport staff, security, or the crew; for immediate danger, use local emergency services." },
    ],
  },
} as const;

export type PolicySlug = keyof typeof policies;

export function getPolicy(slug: string) {
  return Object.prototype.hasOwnProperty.call(policies, slug) ? policies[slug as PolicySlug] : undefined;
}