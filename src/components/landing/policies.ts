export const policies = {
  privacy: {
    title: "Privacy notice",
    intro: "Here’s what you enter in Flight Share, what other travelers may see, and what you can control.",
    sections: [
      { title: "Information you provide", text: "Guest access doesn’t ask for an email. Flight Share keeps a session cookie in this browser and uses your IP address to limit abuse. We store your profile, flight-room memberships, baggage estimates, travel and ride preferences, and actions such as messages, ride confirmations, blocks, and reports." },
      { title: "What matched riders can see", text: "If you opt into airport ride matching, eligible riders who have also opted in may see your display name or alias, flight number, departure date and time, party size, and any general pickup area you choose to share. This can include riders on different flights." },
      { title: "Direct messages and flight group chat", text: "A ride chat is between you and the matched rider you contact. In a flight room’s group chat, eligible members can see your display name or alias and your posts. This includes people who join the room after you post. A ride match alone doesn’t give someone access to your flight’s group chat. Flight Share stores messages, and recipients may save or forward what you send." },
      { title: "Profile and flyer progress visibility", text: "Members of your flight room may see your display name or alias and the details you choose to show. Your profile setup progress is not visible to other travelers. Flyer progress is separate and reflects eligible flights added and rides confirmed. Eligible ride matches can see your flyer tier, points, and activity counts by default. You can turn this off in your profile settings. Flyer progress doesn’t verify your identity, ticket, or boarding status." },
      { title: "Your controls", text: "You can adjust profile visibility, block or report travellers, and delete your account. An alias changes what fellow travelers see; it does not hide your account from the service. Leaving a room, clearing cookies, or losing your guest session does not itself erase stored information. Guest access cannot be recovered." },
      { title: "Sensitive information", text: "Don’t put your passport, booking reference, boarding pass, payment details, or other sensitive identifying information in your profile or messages." },
    ],
  },
  terms: {
    title: "Terms of use",
    intro: "Flight Share helps travelers coordinate before a trip. It isn’t an airline, a ticketing service, or a transportation provider.",
    sections: [
      { title: "Flight rooms are for coordination", text: "Guests can join rooms using self-reported flight details. A room membership or published schedule does not confirm someone’s identity, reservation, or boarding status. Check your airline’s official information before relying on any flight or baggage details." },
      { title: "Rides to the departure airport", text: "Ride matching is for travelers headed to the same departure airport whose scheduled takeoff times are no more than 20 minutes apart. You may be on different flights. You decide whether to ride together and are responsible for agreeing on pickup, timing, terminal drop-off and costs. Flight Share doesn’t book, provide, or take payment for transportation." },
      { title: "Same-flight baggage matching", text: "Potential baggage matches are limited to passengers on the exact same flight. Estimates do not transfer any allowance or authorize pooling. Only consider pooling if your airline permits it for your booking and bags. Pack and carry only your own belongings; don’t transport anyone else’s items." },
      { title: "Respect others’ privacy", text: "Opting into ride matching makes selected trip and pickup details visible to eligible matched riders. Direct ride chats are between the two matched riders. Flight group chat posts can be read by eligible members, including those who join the flight room later. Eligible ride matches can see your flyer progress unless you turn it off in settings; it isn’t a verification badge. Don’t repost another traveler’s messages, pickup details, or profile information without permission." },
      { title: "Use the service respectfully", text: "Provide accurate travel details, respect other travelers’ choices, and don’t use the service to harass, impersonate, solicit payments, or share someone else’s personal information without permission." },
    ],
  },
  contact: {
    title: "Contact",
    intro: "Where to go for account help, traveler safety, and questions about your trip.",
    sections: [
      { title: "Get help with this deployment", text: "There is no public support address supplied for this demo. Use the contact details given to you by the operator of the deployment for account, privacy, or accessibility questions." },
      { title: "Report a traveler", text: "Use the report option in Flight Share for concerns about another traveler. For immediate help, contact airport staff, the flight crew, or local emergency services rather than waiting for a report response." },
      { title: "Contact your airline for flight questions", text: "Your airline can help with bookings, flight changes, baggage rules, and boarding. Flight Share can’t modify a reservation or approve a baggage arrangement." },
    ],
  },
  community: {
    title: "Community guidelines",
    intro: "A good flight room makes it easy to say hello and just as easy to say no. Help keep it that way.",
    sections: [
      { title: "Respect a no, including no reply", text: "No one owes you a conversation, a ride, or an in-person meet-up. Don’t repeatedly contact someone who doesn’t respond or pressure them into an arrangement." },
      { title: "Be honest and don’t ask for sensitive details", text: "Don’t impersonate another traveler or an airline representative. Don’t ask for money, booking codes, boarding passes, or identity documents. Harassment, threats, hate, and scams don’t belong here." },
      { title: "Meet on your own terms", text: "Keep early conversations in the app. Start with a general pickup area, then choose a public meeting spot if you decide to ride together. Don’t share someone else’s pickup details. Pack and carry only your own belongings." },
      { title: "Block, report, or get help where you are", text: "Use the in-app block and report controls if someone makes you uncomfortable or breaks these guidelines. A report is not an emergency call. If you feel unsafe at an airport or on board, contact airport staff, security, or the crew; for immediate danger, use local emergency services." },
    ],
  },
} as const;

export type PolicySlug = keyof typeof policies;

export function getPolicy(slug: string) {
  return Object.prototype.hasOwnProperty.call(policies, slug) ? policies[slug as PolicySlug] : undefined;
}