import type {Metadata} from 'next';
import {ConversationPage} from '@/components/app/messages';

export const metadata: Metadata = {title: 'Conversation | Flight Share'};
export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <ConversationPage key={id} id={id} />;
}