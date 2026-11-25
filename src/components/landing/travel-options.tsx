import { ArrowDown, ArrowRight, CarFront, Luggage, MapPin, Plane } from "lucide-react";

export function TravelOptions() {
  return (
    <section id="travel-options" className="fs-options" aria-labelledby="options-title">
      <div className="fs-container fs-section">
        <div className="fs-section-heading">
          <p className="fs-kicker fs-section-kicker"><span /> FIND YOUR MATCH</p>
          <h2 id="options-title">Two ways to share the journey.</h2>
          <p>Cab listings are based on your departure airport and scheduled flight time. Baggage matches are based on your exact flight.</p>
        </div>
        <div className="fs-option-grid">
          <article id="airport-rides" className="fs-option" aria-labelledby="rides-title">
            <div className="fs-option-top">
              <span className="fs-option-icon"><CarFront size={24} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="fs-option-tag">SAME DEPARTURE AIRPORT</span>
            </div>
            <h3 id="rides-title">Share a ride to the airport</h3>
            <p>Offer spare seats or request seats from a host travelling to the same departure airport. Adjust the departure window to include flights near your own.</p>
            <div className="fs-option-diagram" role="img" aria-label="Example ride: from Connaught Place to Delhi airport">
              <span><MapPin size={17} aria-hidden="true" /> Connaught Place</span>
              <ArrowRight className="fs-option-arrow" size={16} aria-hidden="true" />
              <span><Plane size={17} aria-hidden="true" /> Delhi airport (DEL)</span>
            </div>
            <p className="fs-option-note">List a general pickup area. Once a seat request is accepted, agree on a public pickup point, timing and fare split in private chat.</p>
            <a className="fs-text-link" href="#ride-faq">How ride matching works <ArrowDown size={16} aria-hidden="true" /></a>
          </article>
          <article id="baggage-matching" className="fs-option" aria-labelledby="baggage-title">
            <div className="fs-option-top">
              <span className="fs-option-icon"><Luggage size={24} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="fs-option-tag">EXACT SAME FLIGHT</span>
            </div>
            <h3 id="baggage-title">Explore baggage allowance matches</h3>
            <p>Open Baggage matches in your flight room to compare estimates. If you expect to be over your allowance and someone else expects spare capacity, send a request to see if they’re interested.</p>
            <div className="fs-option-diagram" role="img" aria-label="Example baggage match: estimated excess weight and estimated spare allowance">
              <span className="fs-baggage-over">Over allowance</span>
              <ArrowRight className="fs-option-arrow" size={16} aria-hidden="true" />
              <span className="fs-baggage-spare">Spare allowance</span>
            </div>
            <p className="fs-option-note">Only pool allowance if your airline permits it. A match doesn’t transfer allowance. Always pack and carry only your own belongings.</p>
            <a className="fs-text-link" href="#baggage-faq">How baggage matching works <ArrowDown size={16} aria-hidden="true" /></a>
          </article>
        </div>
      </div>
    </section>
  );
}