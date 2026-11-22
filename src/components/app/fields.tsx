'use client';

import type {ReactNode} from 'react';
import {formatKg, transportationLabels, type Baggage, type Preferences, type RideSettings, type Transportation} from './api';

export function Field({label, children, hint}: {label: string; children: ReactNode; hint?: string}) {
  return <label className="fa-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Toggle({label, hint, checked, onChange}: {label: string; hint: string; checked: boolean; onChange: (value: boolean) => void}) {
  return <label className="fa-toggle"><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

export function PreferenceFields({value, onChange, suggestedName, compact = false}: {value: Preferences; onChange: (value: Preferences) => void; suggestedName?: string; compact?: boolean}) {
  const optional = <div className="fa-toggles">
    <Field label="Ground transportation"><select value={value.transportation === 'CAB_SHARE' ? 'NONE' : value.transportation} onChange={(event) => onChange({...value, transportation: event.target.value as Transportation})}>
      {Object.entries(transportationLabels).filter(([key]) => key !== 'CAB_SHARE').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></Field>
    <Toggle label="Open to travel companionship" hint="Let other travellers know you’re open to spending time together at the airport." checked={value.companionship} onChange={(companionship) => onChange({...value, companionship})} />
    <Toggle label="Show my baggage details" hint="Your baggage weights can be used for potential matches when visible." checked={value.showBaggage} onChange={(showBaggage) => onChange({...value, showBaggage})} />
    <Toggle label="Show my travel preferences" hint="Show your group size and travel preferences in the passenger list. Ride discovery has its own opt-in." checked={value.showTravelPreferences} onChange={(showTravelPreferences) => onChange({...value, showTravelPreferences})} />
    <Toggle label="Show my flyer progress" hint="Let eligible ride matches see your points, tier and activity counts. This is not a booking or identity check." checked={value.showFlyer} onChange={(showFlyer) => onChange({...value, showFlyer})} />
  </div>;
  return <div className="fa-form">
    <Field label="Display name"><input autoComplete="nickname" required maxLength={48} placeholder="e.g. Alex" value={value.displayName} onChange={(event) => onChange({...value, displayName: event.target.value})} /></Field>
    {suggestedName && suggestedName !== value.displayName && <div className="fa-name-suggestion"><span>First name from your ticket</span><button type="button" className="fa-button fa-secondary fa-compact" onClick={() => onChange({...value, displayName: suggestedName})}>Use {suggestedName}</button></div>}
    <Toggle label="Show me as anonymous" hint="Other travellers will see a room-specific alias instead of your display name." checked={value.isAnonymous} onChange={(isAnonymous) => onChange({...value, isAnonymous})} />
    {compact ? <details className="fa-extra-preferences"><summary>More profile and privacy options</summary>{optional}</details> : optional}
  </div>;
}

export type RideDraft = Omit<RideSettings, 'pickupArea'> & {pickupArea: string};
export const defaultRide: RideDraft = {partySize: 1, rideOptIn: false, pickupArea: ''};
export const ridePayload = (value: RideDraft): RideSettings => ({...value, pickupArea: value.rideOptIn ? value.pickupArea.trim() || null : null});

export function RideFields({value, onChange}: {value: RideDraft; onChange: (value: RideDraft) => void}) {
  return <div className="fa-form">
    <Field label="Party size" hint="Include yourself and anyone travelling with you."><select value={value.partySize} onChange={(event) => onChange({...value, partySize: Number(event.target.value)})}>
      {Array.from({length: 12}, (_, index) => <option key={index + 1} value={index + 1}>{index === 0 ? '1 · Just me' : `${index + 1} travellers`}</option>)}
    </select></Field>
    <Toggle label="Find an airport ride to share" hint="Let eligible travellers see your flight, party size and optional pickup area, even on different flights." checked={value.rideOptIn} onChange={(rideOptIn) => onChange({...value, rideOptIn, pickupArea: rideOptIn ? value.pickupArea : ''})} />
    {value.rideOptIn && <Field label="Pickup area (optional)" hint="Use a neighbourhood or station only. No exact addresses or contact details."><input maxLength={60} placeholder="e.g. Paddington" value={value.pickupArea} onChange={(event) => onChange({...value, pickupArea: event.target.value})} /></Field>}
  </div>;
}

export type BaggageDraft = {allowance: string; expected: string; cabin: string};
export const emptyBaggage: BaggageDraft = {allowance: '', expected: '', cabin: ''};
export const baggageDraft = (value: Baggage): BaggageDraft => ({allowance: String(value.baggageAllowance), expected: String(value.expectedBaggageWeight), cabin: value.cabinBaggage ?? ''});
export const baggagePayload = (value: BaggageDraft): Baggage => ({baggageAllowance: Number(value.allowance), expectedBaggageWeight: Number(value.expected), cabinBaggage: value.cabin.trim() || null});

export function BaggageFields({value, onChange, optional = false}: {value: BaggageDraft; onChange: (value: BaggageDraft) => void; optional?: boolean}) {
  const balance = Math.round(Number(value.allowance) * 100 - Number(value.expected) * 100) / 100;
  const required = !optional || value.allowance !== '' || value.expected !== '' || value.cabin.trim() !== '';
  return <div className="fa-form">
    <div className="fa-fields-two">
      <Field label="Baggage allowance (kg)"><input type="number" inputMode="decimal" min="0" max="250" step="0.01" required={required} placeholder="e.g. 23" value={value.allowance} onChange={(event) => onChange({...value, allowance: event.target.value})} /></Field>
      <Field label="Expected baggage weight (kg)"><input type="number" inputMode="decimal" min="0" max="250" step="0.01" required={required} placeholder="e.g. 18" value={value.expected} onChange={(event) => onChange({...value, expected: event.target.value})} /></Field>
    </div>
    <Field label="Cabin baggage notes (optional)"><input maxLength={120} placeholder="e.g. One small backpack" value={value.cabin} onChange={(event) => onChange({...value, cabin: event.target.value})} /></Field>
    {value.allowance !== '' && value.expected !== '' && <p className={`fa-balance${balance > 0 ? ' fa-weight-available' : balance < 0 ? ' fa-weight-excess' : ''}`} aria-live="polite">{balance === 0 ? 'Expected weight matches your allowance.' : `${formatKg(Math.abs(balance))} ${balance > 0 ? 'available' : 'over your allowance'}`}</p>}
  </div>;
}