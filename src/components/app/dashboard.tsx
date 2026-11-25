'use client';

import Link from 'next/link';
import {ArrowUpRight, History, Plane} from 'lucide-react';
import {useEffect} from 'react';
import type {Profile} from './api';
import {AppShell} from './app-shell';
import {FlyerProgress} from './flyer';
import {useRealtime} from './realtime';
import {Empty, ErrorMessage, FlightTicket, Loading} from './ui';
import {useResource} from './use-resource';

export function Dashboard({past = false}: {past?: boolean}) {
  const profile = useResource<Profile>('profile?refresh=arrivals');
  const {reload} = profile;
  const entries = past ? profile.data?.pastFlights : profile.data?.flights;
  useRealtime({connect: reload, 'flight:updated': reload, 'conversation:updated': reload});
  useEffect(() => {
    const refresh = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, [reload]);
  useEffect(() => {
    const now = Date.now();
    const next = profile.data?.flights.map(({historyAt}) => historyAt ? Date.parse(historyAt) : NaN)
      .filter((cutoff) => cutoff > now && cutoff - now < 60_000).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(reload, next - now + 100);
    return () => clearTimeout(timer);
  }, [profile.data, reload]);
  return <AppShell area="dashboard" past={past}>
    <section className="fa-section fa-dashboard-flights" aria-labelledby="joined-flights">
      <div className="fa-section-head"><div><h1 id="joined-flights">{past ? 'Past flights' : 'My flights'}</h1><p className="fa-muted">{past ? 'Your previous trips and their conversations.' : 'Your upcoming and in-progress trips.'}</p></div>{entries && <span className="fa-badge">{entries.length} {entries.length === 1 ? 'flight' : 'flights'}</span>}</div>
      <ErrorMessage error={profile.error} retry={profile.reload} />
      {!profile.data && !profile.error && <Loading label="Loading your flights…" />}
      {entries?.length === 0 && <Empty icon={past ? History : Plane} title={past ? 'No past flights yet' : 'No active flights'}><p>{past ? 'Trips will appear here once they are no longer active.' : 'Add a flight to see it here.'}</p></Empty>}
      {!!entries?.length && <div className="fa-flight-grid">{entries.map((flight) => <article key={flight.id} className="fa-flight-card"><FlightTicket flight={flight} members={flight.memberCount} /><Link className="fa-room-link" href={`/flights/${flight.id}`} aria-label={`Open ${flight.airline} ${flight.flightNumber}, ${flight.departureAirport} to ${flight.arrivalAirport}, ${flight.departureDate}`}>Open flight <ArrowUpRight size={17} aria-hidden="true" /></Link></article>)}</div>}
    </section>
    {!past && profile.data?.flyer && <FlyerProgress flyer={profile.data.flyer} isPublic={profile.data.profile?.showFlyer ?? true} />}
  </AppShell>;
}