import Link from 'next/link';
import {ArrowUpRight, Award} from 'lucide-react';
import type {Flyer} from './api';

const tierTargets = { 'New Flyer': 300, 'Silver Flyer': 700, 'Gold Flyer': 1500, 'Platinum Flyer': null } as const;
const nextTiers = { 'New Flyer': 'Silver Flyer', 'Silver Flyer': 'Gold Flyer', 'Gold Flyer': 'Platinum Flyer', 'Platinum Flyer': null } as const;

export function FlyerBadge({flyer}: {flyer: Flyer}) {
  return <span className="fa-badge fa-flyer-badge"><Award size={14} aria-hidden="true" /> {flyer.tier} · {flyer.points.toLocaleString('en')} points</span>;
}

export function FlyerProgress({flyer, isPublic}: {flyer: Flyer; isPublic: boolean}) {
  const target = tierTargets[flyer.tier];
  const next = nextTiers[flyer.tier];
  return <section className="fa-panel fa-flyer-progress" aria-labelledby="flyer-progress">
    <div className="fa-panel-head"><span className="fa-icon-box"><Award size={24} aria-hidden="true" /></span><div><h2 id="flyer-progress">Your flyer progress</h2><p>Community activity, not airline or booking verification.</p></div></div>
    <FlyerBadge flyer={flyer} />
    <dl className="fa-flyer-counts"><div><dt>Flights added</dt><dd>{flyer.flightsAdded.toLocaleString('en')}</dd></div><div><dt>Rides confirmed by both travellers</dt><dd>{flyer.ridesConfirmed.toLocaleString('en')}</dd></div></dl>
    {target && next ? <div className="fa-flyer-next"><label><span>{Math.max(0, target - flyer.points).toLocaleString('en')} points to {next}</span><progress value={flyer.points} max={target} /></label></div> : <p className="fa-entry-caption">You’ve reached the highest tier.</p>}
    <p className="fa-entry-caption">Earn 100 points for each distinct non-demo flight you add, plus 50 when both travellers confirm an eligible ride, with one ride bonus per flight.</p>
    <Link className="fa-link" href="/dashboard/settings">{isPublic ? 'Visible to eligible ride matches' : 'Hidden from other travellers'} <ArrowUpRight size={15} aria-hidden="true" /></Link>
  </section>;
}