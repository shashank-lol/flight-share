import type {Metadata} from 'next';
import {FlightRoom} from '@/components/app/flight-room';

export const metadata: Metadata = {title: 'Flight room | Flight Share'};

export default async function FlightPage({params, searchParams}: {params: Promise<{id: string}>; searchParams: Promise<{tab?: string}>}) {
  const [{id}, {tab}] = await Promise.all([params, searchParams]);
  return <FlightRoom flightId={id} tab={tab} />;
}