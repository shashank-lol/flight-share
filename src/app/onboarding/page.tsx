import type {Metadata} from 'next';
import {Onboarding} from '@/components/app/onboarding';

export const metadata: Metadata = {title: 'Find your flight | Flight Share'};

export default async function OnboardingPage({searchParams}: {searchParams: Promise<{add?: string}>}) {
  return <Onboarding addFlight={(await searchParams).add === '1'} />;
}