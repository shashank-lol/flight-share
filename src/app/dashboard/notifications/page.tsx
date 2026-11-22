import type {Metadata} from 'next';
import {NotificationsPage} from '@/components/app/notifications';

export const metadata: Metadata = {title: 'Notifications | Flight Share'};
export default function Page() { return <NotificationsPage />; }