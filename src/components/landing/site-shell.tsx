import Link from "next/link";
import { ArrowUpRight, Navigation, Plane } from "lucide-react";

export function Wordmark() {
  return (
    <Link className="fs-wordmark" href="/" aria-label="Flight Share home">
      <span className="fs-brand-mark" aria-hidden="true"><Navigation size={18} strokeWidth={2.4} /></span>
      <span>Flight<span className="fs-wordmark-accent">Share</span></span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="fs-header">
      <div className="fs-container fs-header-inner">
        <Wordmark />
        <nav className="fs-nav" aria-label="Main navigation">
          <Link href="/#airport-rides">Airport rides</Link>
          <Link href="/#baggage-matching">Baggage matches</Link>
          <Link href="/#faq">FAQs</Link>
        </nav>
        <div className="fs-header-actions">
      <Link className="fs-sign-in" href="/dashboard">My flights</Link>
          <Link className="fs-button fs-button-small fs-button-dark" href="/onboarding">Get started <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="fs-footer">
      <div className="fs-container">
        <div className="fs-footer-top">
          <div><Wordmark /><p>Airport rides and same-flight baggage matches.</p></div>
          <nav className="fs-footer-links" aria-label="Footer navigation">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/community">Community guidelines</Link>
            <Link href="/legal/contact">Contact</Link>
          </nav>
        </div>
        <div className="fs-footer-bottom">
          <span>© {new Date().getUTCFullYear()} Flight Share.</span>
          <span><Plane size={14} aria-hidden="true" /> Independent of airlines and ride providers.</span>
        </div>
      </div>
    </footer>
  );
}