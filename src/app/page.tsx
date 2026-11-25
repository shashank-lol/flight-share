import type { Viewport } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, CarFront, Check, Globe2, LockKeyhole, Luggage, MessageCircle, Plane, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { TravelOptions } from "@/components/landing/travel-options";
import { SiteFooter, SiteHeader } from "@/components/landing/site-shell";

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#f8fbff",
};

const steps = [
  { icon: Plane, title: "Find your flight", text: "Join your flight room using your itinerary. For example, a trip from Delhi (DEL) to Bengaluru (BLR)." },
  { icon: SlidersHorizontal, title: "Choose what to share", text: "Post or request seats in Share a cab, or add your allowance and estimated weight in Baggage matches." },
  { icon: MessageCircle, title: "Make a plan together", text: "Once a host accepts your seat request, use the private chat to coordinate. For baggage, both travellers must agree to a match and check with their airline." },
];

const safetyFeatures = [
  { icon: SlidersHorizontal, title: "Share only what you need to", text: "Use an alias and choose whether to show your baggage and travel preferences. Keep pickup details general until you agree to ride together." },
  { icon: LockKeyhole, title: "Keep personal details private", text: "You don’t need to share your email or phone number to start a conversation. Never post a boarding pass or booking reference in chat." },
  { icon: ShieldCheck, title: "Block or report when you need to", text: "You don’t have to chat, share a ride, or meet up. If someone crosses a line, use the in-app block or report tools." },
];

const faqs = [
  { id: "ride-faq", question: "Do we need to be on the same flight to share a ride?", answer: "No. Browse cab listings for the same departure airport. The search defaults to 20 minutes either side of your scheduled flight departure, and you can set it anywhere from 0 to 60 minutes. This is for rides to the airport, not from the airport after landing." },
  { question: "How do we agree on pickup and timing?", answer: "Post a listing with a general pickup area, such as Dwarka in Delhi, or request seats in an existing listing. After the host accepts, agree on a public pickup point, pickup time, terminal drop-offs and fare split. Allow time for check-in and security. Flight Share doesn’t book rides or handle payments." },
  { id: "baggage-faq", question: "Who can be a baggage match?", answer: "Only passengers on your exact flight. The Baggage matches section compares one traveller’s estimated excess weight with another’s estimated spare allowance. Both travellers must agree to confirm a match." },
  { question: "Does a baggage match let me carry someone else’s things?", answer: "No. Always pack and carry only your own belongings. Flight Share can’t transfer or approve baggage allowance. Only consider pooling allowance if your airline explicitly permits it for your booking and bags." },
  { question: "Does Flight Share verify travellers or book anything?", answer: "No. Flight details entered by travellers don’t prove their identity, reservation, or boarding status. Flight Share doesn’t book flights or rides. Use your airline for reservations, changes, and official baggage rules." },
];

export default function HomePage() {
  return (
    <div className="fs-site">
      <a className="fs-skip-link" href="#main-content">Skip to content</a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <section className="fs-container fs-hero" aria-labelledby="hero-title">
          <div className="fs-hero-copy">
            <p className="fs-kicker fs-hero-kicker"><span /> BEFORE TAKEOFF</p>
            <h1 id="hero-title">Share a ride. <span>Explore baggage matches.</span></h1>
            <p className="fs-hero-description">Offer or request cab seats to your departure airport, or explore a possible baggage allowance match with someone on your exact flight.</p>
            <div className="fs-hero-actions">
              <Link className="fs-button fs-button-dark" href="/onboarding">Find My Flight <ArrowUpRight size={19} aria-hidden="true" /></Link>
              <a className="fs-text-link" href="#travel-options">Explore both options <ArrowDown size={16} aria-hidden="true" /></a>
            </div>
          </div>
          <div className="fs-hero-art">
            <Image className="fs-hero-photo" src="/images/above-the-clouds.webp" alt="A plane wing above sunlit clouds" width={1440} height={1200} preload unoptimized />
            <div className="fs-photo-caption" aria-hidden="true"><span /> THE WINDOW SEAT</div>
            <div className="fs-hero-brief">
              <p className="fs-brief-label">TWO WAYS TO PLAN</p>
              <ul>
                <li><a href="#airport-rides"><CarFront size={18} aria-hidden="true" /><div><strong>Airport rides</strong><span>Same departure airport</span></div></a></li>
                <li><a href="#baggage-matching"><Luggage size={18} aria-hidden="true" /><div><strong>Baggage matches</strong><span>Exact same flight only</span></div></a></li>
              </ul>
            </div>
          </div>
        </section>

        <TravelOptions />

        <section id="how-it-works" className="fs-section fs-container" aria-labelledby="steps-title">
          <div className="fs-section-heading">
            <p className="fs-kicker fs-section-kicker"><span /> HOW IT WORKS</p>
            <h2 id="steps-title">From flight details to a plan.</h2>
          </div>
          <ol className="fs-steps">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="fs-step">
                <div className="fs-step-top"><span className="fs-step-icon"><Icon size={24} strokeWidth={1.8} aria-hidden="true" /></span><span className="fs-step-index" aria-hidden="true">0{index + 1}</span></div>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="safety" className="fs-safety" aria-labelledby="safety-title">
          <div className="fs-container fs-safety-inner">
            <div className="fs-safety-copy">
              <p className="fs-kicker fs-section-kicker"><span /> PRIVACY &amp; SAFETY</p>
              <h2 id="safety-title">Your trip.<br /> Your boundaries.</h2>
              <p className="fs-safety-intro">You choose what to share and whether to make plans with another traveller.</p>
              <Link className="fs-text-link fs-safety-link" href="/legal/privacy">See what others can view <ArrowUpRight size={17} aria-hidden="true" /></Link>
            </div>
            <ul className="fs-safety-features">
              {safetyFeatures.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <span className="fs-safety-icon"><Icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
                  <div><h3>{title}</h3><p>{text}</p></div>
                  <Check className="fs-safety-check" size={17} aria-hidden="true" />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="faq" className="fs-section fs-container" aria-labelledby="questions-title">
          <div className="fs-questions">
            <div className="fs-section-heading">
              <p className="fs-kicker fs-section-kicker"><span /> BEFORE YOU BOARD</p>
              <h2 id="questions-title">Good to know.</h2>
            </div>
            <div className="fs-faq">
              {faqs.map(({ id, question, answer }) => (
                <details key={question}><summary>{question}</summary><p id={id}>{answer}</p></details>
              ))}
            </div>
          </div>
        </section>

        <section className="fs-container fs-cta-section" aria-labelledby="cta-title">
          <div className="fs-cta">
            <Globe2 className="fs-cta-art" size={400} strokeWidth={0.45} aria-hidden="true" />
            <div>
              <p className="fs-kicker fs-section-kicker"><span /> READY WHEN YOU ARE</p>
              <h2 id="cta-title">Start with your flight.</h2>
              <p>Look for an airport ride or a potential baggage allowance match.</p>
            </div>
            <Link className="fs-button fs-button-dark" href="/onboarding">Find My Flight <ArrowRight size={19} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}