import type {Metadata} from 'next';
import {MessagesPage} from '@/components/app/messages';

export const metadata: Metadata = {title: 'Messages | Flight Share'};
export default function Page() { return <MessagesPage />; }