import type {Metadata} from 'next';
import {SettingsPage} from '@/components/app/settings';

export const metadata: Metadata = {title: 'Profile and safety | Flight Share'};
export default function Page() { return <SettingsPage />; }