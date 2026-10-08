import React, { useState } from 'react';
import { Check as CheckIcon, Copy } from 'lucide-react';

// Panolarda ortak küçük parçalar: kopyala düğmesi, olgu satırı (etiket + değer) ve numaralı adım.

export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); }}
      className="text-gray-500 hover:text-ink p-1 -m-1 align-middle"
      aria-label={done ? 'Copied' : label}
    >
      {done ? <CheckIcon className="w-3.5 h-3.5 text-verified" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/** <dl> içinde bir olgu satırı: solda etiket, sağda değer, üstte ince çizgi. */
export function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-4 py-3 border-t border-rule text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Gerçekten sıralı akışlar için numaralı adım: numara ve dikey çizgi sırayı anlatır. */
export function Step({ n, title, children, last = false }) {
  return (
    <section className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4" aria-labelledby={`step-${n}`}>
      <div className="flex flex-col items-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-ink text-sm font-semibold text-ink" aria-hidden="true">{n}</span>
        {!last && <span className="mt-1 w-px flex-1 bg-rule" aria-hidden="true" />}
      </div>
      <div className={`min-w-0 ${last ? '' : 'pb-10'}`}>
        <h2 id={`step-${n}`} className="text-base font-semibold text-ink leading-7">{title}</h2>
        <div className="mt-3 space-y-4">{children}</div>
      </div>
    </section>
  );
}
