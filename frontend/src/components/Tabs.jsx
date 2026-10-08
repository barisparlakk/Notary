import React, { useRef } from 'react';

// Düz sekmeler: aktif olan alt çizgiyle gösterilir. Ok tuşlarıyla gezilir (WAI-ARIA sekme deseni).
export default function Tabs({ options, value, onChange, label, className = '' }) {
  const refs = useRef([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e) => {
    let next = null;
    if (e.key === 'ArrowRight') next = (index + 1) % options.length;
    if (e.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = options.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex gap-6 overflow-x-auto no-scrollbar ${className}`}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`whitespace-nowrap py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active ? 'border-ink text-ink' : 'border-transparent text-gray-600 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
