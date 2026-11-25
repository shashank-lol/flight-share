'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft, Bell, ChevronRight, History, LayoutGrid, MessageCircle, Plane, Plus, Settings, ShieldCheck} from 'lucide-react';
import {createContext, useContext, useEffect, type ReactNode} from 'react';
import {useRealtime} from './realtime';
import {MoreActions} from './more-actions';
import type {Notifications} from './social-types';
import {AppBrand} from './ui';
import {useResource} from './use-resource';

export type Area = 'dashboard' | 'flight' | 'messages' | 'notifications' | 'settings';
const navigation = [
  {area: 'dashboard', href: '/dashboard', name: 'My flights', icon: LayoutGrid},
  {area: 'messages', href: '/dashboard/messages', name: 'Messages', icon: MessageCircle},
  {area: 'notifications', href: '/dashboard/notifications', name: 'Notifications', icon: Bell},
  {area: 'settings', href: '/dashboard/settings', name: 'Settings', icon: Settings},
] as const;
const NotificationUnread = createContext(0);
export function useNotificationUnread() { return useContext(NotificationUnread); }

export function AppShell({area, breadcrumb, children, past = false}: {area: Area; breadcrumb?: string; children: ReactNode; past?: boolean}) {
  const router = useRouter();
  const notices = useResource<Notifications>('notifications');
  useRealtime({connect: notices.reload, 'notification:new': notices.reload, 'conversations:updated': notices.reload, 'session:revoked': () => router.replace('/onboarding')});
  useEffect(() => {
    window.addEventListener('flightshare:notifications', notices.reload);
    return () => window.removeEventListener('flightshare:notifications', notices.reload);
  }, [notices.reload]);
  const unread = notices.data?.unreadCount ?? 0;
  return <NotificationUnread.Provider value={unread}><div className={`fa-app${area === 'flight' ? ' fa-flight-shell' : area === 'dashboard' ? ' fa-dashboard-shell' : ''}`}>
    <a className="fs-skip-link" href="#app-main">Skip to content</a>
    <header className="fa-app-header"><div className="fa-wrap fa-header-inner"><div className="fa-header-brand">{(area === 'flight' || past) && <Link href="/dashboard" className={`fa-icon-button${area === 'flight' ? ' fa-flight-shortcut' : ''}`} aria-label="My flights" title="My flights"><ArrowLeft size={20} aria-hidden="true" /></Link>}<AppBrand /></div>{area !== 'flight' && <div className="fa-header-right"><Link href="/onboarding?add=1" className="fa-button fa-primary fa-compact fa-header-add"><Plus size={17} aria-hidden="true" /> <span>Add flight</span></Link>{area === 'dashboard' && <MoreActions label="More flight options" unread={unread}>
      {past ? <Link className="fa-more-item" href="/dashboard"><LayoutGrid size={18} aria-hidden="true" /> My flights</Link> : <Link className="fa-more-item" href="/dashboard/history"><History size={18} aria-hidden="true" /> Past flights</Link>}
      {navigation.filter(({area}) => area !== 'dashboard').map(({area, href, name, icon: Icon}) => <Link key={area} href={href} className="fa-more-item"><Icon size={18} aria-hidden="true" /> {name}{area === 'notifications' && unread > 0 && <span className="fa-count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}</Link>)}
      <Link href="/legal/community" className="fa-more-item"><ShieldCheck size={18} aria-hidden="true" /> Community guidelines</Link>
    </MoreActions>}</div>}</div></header>
    <div className="fa-wrap fa-shell">
      <aside className="fa-sidebar">
        <p className="fa-sidebar-label">WORKSPACE</p>
        <nav aria-label="Workspace navigation">
          {navigation.map(({area: item, href, name, icon: Icon}) => <Link href={href} key={item} aria-current={area === item || (area === 'flight' && item === 'dashboard') ? 'page' : undefined}>
            <Icon size={19} aria-hidden="true" /> <span>{name}</span>{item === 'notifications' && unread > 0 && <b className="fa-count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</b>}
          </Link>)}
        </nav>
        <div className="fa-sidebar-safety"><ShieldCheck size={19} aria-hidden="true" /><p>Travel safely<Link href="/legal/community">Community guidelines <ChevronRight size={13} aria-hidden="true" /></Link></p></div>
      </aside>
      <main className="fa-main" id="app-main" tabIndex={-1}>
        {breadcrumb && <div className="fa-breadcrumb"><Link href="/dashboard"><Plane size={15} aria-hidden="true" /> My flights</Link><ChevronRight size={13} aria-hidden="true" /><span>{breadcrumb}</span></div>}
        {children}
      </main>
    </div>
  </div></NotificationUnread.Provider>;
}