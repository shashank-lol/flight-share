'use client';

import {Ellipsis} from 'lucide-react';
import {useEffect, useId, useRef, useState, type ReactNode} from 'react';

export function MoreActions({label, children, className = '', unread = 0}: {label: string; children: ReactNode; className?: string; unread?: number}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={root} className={`fa-more ${className}`}>
    <button ref={trigger} type="button" className="fa-icon-button fa-more-trigger" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}><Ellipsis size={22} aria-hidden="true" /><span aria-hidden="true">More</span>{unread > 0 && <i className="fa-more-unread" />}</button>
    {open && <div id={id} className="fa-more-panel" onClick={(event) => { if (event.target instanceof Element && event.target.closest('button, a')) setOpen(false); }}>{children}</div>}
  </div>;
}