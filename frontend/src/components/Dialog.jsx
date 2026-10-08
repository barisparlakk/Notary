import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Erişilebilir pencere: role="dialog", Escape ile kapanır, Tab pencere içinde döner, açılınca ilk öğeye odaklanır,
// kapanınca odağı açan öğeye geri verir, arka sayfa kaymaz, arka plana tıklayınca kapanır.
export default function Dialog({ title, onClose, children, className = '' }) {
  const panel = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    const el = panel.current;
    const items = () => [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    (items().find((n) => n.getAttribute('aria-label') !== 'Close') || items()[0] || el).focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const list = items();
        if (!list.length) { e.preventDefault(); return; }
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`cal-card max-w-xl w-full p-6 space-y-4 shadow-2xl bg-white border border-gray-300 max-h-[90vh] overflow-y-auto ${className}`}
      >
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <span id={titleId} className="text-sm font-bold text-gray-900 font-sans">{title}</span>
          <button onClick={() => closeRef.current()} className="text-gray-400 hover:text-gray-900 cursor-pointer p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
