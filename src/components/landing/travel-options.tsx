import { ArrowDown, ArrowRight, CarFront, Luggage, MapPin, Plane } from "lucide-react";

export function TravelOptions() {
  return (
    <section id="travel-options" className="fs-options" aria-labelledby="options-title">
      <div className="fs-container fs-section">
        <div className="fs-section-heading">
          <p className="fs-kicker fs-section-kicker"><span /> FIND YOUR MATCH</p>
          <h2 id="options-title">Two ways to share the journey.</h2>
          <p>Ride matches are based on your airport and takeoff time. Baggage matches are based on your exact flight.</p>
        </div>
        <div className="fs-option-grid">
          <article id="airport-rides" className="fs-option" aria-labelledby="rides-title">
            <div className="fs-option-top">
              <span className="fs-option-icon"><CarFront size={24} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="fs-option-tag">SAME DEPARTURE AIRPORT</span>
            </div>
            <h3 id="rides-title">Share a ride to the airport</h3>
            <p>Look for travelers heading to the same departure airport whose scheduled takeoff is within 20 minutes of yours, earlier or later. You don’t have to be on the same flight.</p>
            <div className="fs-option-diagram" role="img" aria-label="Example ride: from a public pickup point to the departure airport">
              <span><MapPin size={17} aria-hidden="true" /> Public pickup point</span>
              <ArrowRight className="fs-option-arrow" size={16} aria-hidden="true" />
              <span><Plane size={17} aria-hidden="true" /> Departure airport</span>
            </div>
            <p className="fs-option-note">Start with a general pickup area, like a neighborhood or transit station. Agree on the exact spot, pickup time, and fare split yourselves.</p>
            <a className="fs-text-link" href="#ride-faq">How ride matching works <ArrowDown size={16} aria-hidden="true" /></a>
          </article>
          <article id="baggage-matching" className="fs-option" aria-labelledby="baggage-title">
            <div className="fs-option-top">
              <span className="fs-option-icon"><Luggage size={24} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="fs-option-tag">EXACT SAME FLIGHT</span>
            </div>
            <h3 id="baggage-title">Explore baggage allowance matches</h3>
            <p>Compare estimates with passengers on your exact flight. If you expect to be over your allowance and someone else expects spare capacity, that’s a possible match.</p>
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