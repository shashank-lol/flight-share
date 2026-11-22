import Link from 'next/link';
import {AlertCircle, CalendarDays, ChevronLeft, ChevronRight, CircleCheck, LoaderCircle, Navigation, Plane, Users, type LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';
import {ApiError, errorMessage, flightLabel, formatDate, type FlightDetails, type VerificationStatus} from './api';
import './app.css';

export function AppBrand() {
  return <Link className="fs-wordmark" href="/" aria-label="Flight Share home"><span className="fs-brand-mark"><Navigation size={18} strokeWidth={2.4} aria-hidden="true" /></span><span>Flight<span className="fs-wordmark-accent">Share</span></span></Link>;
}

export function Eyebrow({children}: {children: ReactNode}) {
  return <p className="fa-eyebrow"><span />{children}</p>;
}

export function ErrorMessage({error, retry}: {error: unknown; retry?: () => void}) {
  if (!error) return null;
  return <div className="fa-notice fa-error" role="alert"><AlertCircle size={19} aria-hidden="true" /><div>{errorMessage(error)}{error instanceof ApiError && error.status === 401 ? <Link href="/onboarding">Find your flight</Link> : retry ? <button type="button" className="fa-text-button" onClick={retry}>Try again</button> : null}</div></div>;
}

export function Loading({label = 'Loading…'}: {label?: string}) {
  return <div className="fa-loading" role="status"><LoaderCircle size={18} aria-hidden="true" /> {label}</div>;
}

export function Pager({page, hasMore, onChange}: {page: number; hasMore: boolean; onChange: (value: number) => void}) {
  if (page === 1 && !hasMore) return null;
  return <nav className="fa-pager" aria-label="Pagination"><button className="fa-button fa-secondary fa-compact" type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={17} aria-hidden="true" /> Previous</button><span>Page {page}</span><button className="fa-button fa-secondary fa-compact" type="button" disabled={!hasMore} onClick={() => onChange(page + 1)}>Next <ChevronRight size={17} aria-hidden="true" /></button></nav>;
}

export function Notice({icon: Icon = AlertCircle, children}: {icon?: LucideIcon; children: ReactNode}) {
  return <div className="fa-notice"><Icon size={19} aria-hidden="true" /><div>{children}</div></div>;
}

export function Empty({icon: Icon, title, children}: {icon: LucideIcon; title: string; children?: ReactNode}) {
  return <div className="fa-empty"><span className="fa-icon-box"><Icon size={24} aria-hidden="true" /></span><h3>{title}</h3>{children && <div>{children}</div>}</div>;
}

export function StatusBadge({status}: {status: VerificationStatus}) {
  return <span className={`fa-badge${status === 'VERIFIED' ? ' fa-badge-accent' : ''}`}>
    {status === 'VERIFIED' && <CircleCheck size={13} aria-hidden="true" />}
    {status === 'VERIFIED' ? 'Verified' : status === 'MOCK' ? 'Demo booking' : 'Self-reported'}
  </span>;
}

export function FlightTicket({flight, members, status, prominent = false}: {flight: FlightDetails; members?: number; status?: VerificationStatus; prominent?: boolean}) {
  return <div className={`fa-ticket${prominent ? ' fa-ticket-dark' : ''}`}>
    <div className="fa-ticket-head"><span><Plane size={15} aria-hidden="true" /> {flightLabel(flight)}</span>{status && <StatusBadge status={status} />}</div>
    <div className="fa-ticket-route"><strong>{flight.departureAirport}</strong><span aria-hidden="true"><i /><Plane size={18} /><i /></span><strong>{flight.arrivalAirport}</strong></div>
    <div className="fa-ticket-foot"><span><CalendarDays size={15} aria-hidden="true" /> {formatDate(flight.departureDate)}{flight.departureTime ? ` · ${flight.departureTime} local` : ''}</span>{typeof members === 'number' && <span><Users size={15} aria-hidden="true" /> {members} {members === 1 ? 'traveller' : 'travellers'}</span>}</div>
  </div>;
}