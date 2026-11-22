export function flyerStats(flightsAdded: number, ridesConfirmed: number, creditedRideFlights = ridesConfirmed) {
  const points = 100 * flightsAdded + 50 * creditedRideFlights;
  const tier = points >= 1500 ? 'Platinum Flyer' : points >= 700 ? 'Gold Flyer' : points >= 300 ? 'Silver Flyer' : 'New Flyer';
  return {points, tier, flightsAdded, ridesConfirmed};
}