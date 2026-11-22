'use client';

import Link from 'next/link';
import {ArrowRight, ArrowUpRight, Luggage, Plane, Plus, ShieldCheck} from 'lucide-react';
import type {Profile} from './api';
import {AppShell} from './app-shell';
import {FlyerProgress} from './flyer';
import {useRealtime} from './realtime';
import {Empty, ErrorMessage, Eyebrow, FlightTicket, Loading} from './ui';
import {useResource} from './use-resource';

export function Dashboard() {
  const profile = useResource<Profile>('profile');
  useRealtime({connect: profile.reload, 'flight:updated': profile.reload, 'conversation:updated': profile.reload});
  return <AppShell area="dashboard">
    <section className="fa-dashboard-hero">
      <div><Eyebrow>YOUR TRAVEL WORKSPACE</Eyebrow><h1>My flights</h1><p>{profile.data?.profile?.displayName ? `Welcome back, ${profile.data.profile.displayName}.` : 'Welcome to Flight Share.'} Keep track of your flight rooms and connect with your fellow travellers.</p><Link className="fa-button fa-primary" href="/onboarding?add=1"><Plus size={18} aria-hidden="true" /> Add a flight</Link></div>
      <div className="fa-dashboard-art" aria-hidden="true"><Plane size={152} strokeWidth={.7} /></div>
    </section>
    <section className="fa-section" aria-labelledby="joined-flights">
      <div className="fa-section-head"><div><Eyebrow>YOUR ROOMS</Eyebrow><h2 id="joined-flights">Joined flights</h2></div>{profile.data && <span className="fa-badge">{profile.data.flights.length} {profile.data.flights.length === 1 ? 'room' : 'rooms'}</span>}</div>
      <ErrorMessage error={profile.error} retry={profile.reload} />
      {!profile.data && !profile.error && <Loading label="Loading your flights…" />}
      {profile.data?.flights.length === 0 && <Empty icon={Plane} title="Your first flight awaits"><p>Find your flight to join a room for passengers on the same route.</p><Link href="/onboarding?add=1" className="fa-button fa-secondary">Find your flight <ArrowRight size={16} aria-hidden="true" /></Link></Empty>}
      {!!profile.data?.flights.length && <div className="fa-flight-grid">{profile.data.flights.map((flight) => <article key={flight.id} className="fa-flight-card"><FlightTicket flight={flight} members={flight.memberCount} /><Link className="fa-room-link" href={`/flights/${flight.id}`} aria-label={`Open flight room ${flight.airline} ${flight.flightNumber}, ${flight.departureAirport} to ${flight.arrivalAirport}, ${flight.departureDate}`}>Open flight room <ArrowUpRight size={17} aria-hidden="true" /></Link></article>)}</div>}
    </section>
    {profile.data?.flyer && <FlyerProgress flyer={profile.data.flyer} isPublic={profile.data.profile?.showFlyer ?? true} />}
    <div className="fa-tip-grid">
      <div className="fa-tip"><span className="fa-icon-box"><Luggage size={21} aria-hidden="true" /></span><div><h3>Check before you pack</h3><p>Only your airline can confirm baggage limits and rules.</p></div></div>
      <div className="fa-tip"><span className="fa-icon-box"><ShieldCheck size={21} aria-hidden="true" /></span><div><h3>You control what you share</h3><Link className="fa-link" href="/dashboard/settings">Manage your privacy <ArrowRight size={14} aria-hidden="true" /></Link></div></div>
    </div>
  </AppShell>;
}