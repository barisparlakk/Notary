import React, { useState } from 'react';
import AgreementStudio from './AgreementStudio';
import AgreementsPanel from './AgreementsPanel';

export default function Agreements() {
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="max-w-4xl">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="font-display text-4xl font-semibold leading-tight">Agreements</h1>
          <p className="mt-3 text-gray-600 leading-relaxed">
            Files that several people must sign. An agreement counts as agreed only when every party has signed the same file, and each signature is timed by the Solana clock.
          </p>
        </div>
        <button type="button" onClick={() => setCreating((c) => !c)} aria-expanded={creating} className={creating ? 'cal-btn-secondary px-4 py-2 rounded-lg text-sm' : 'cal-btn-primary px-4 py-2 rounded-lg text-sm'}>
          {creating ? 'Close the form' : 'New agreement'}
        </button>
      </header>

      {creating && (
        <section className="mt-10 border-t border-rule pt-8" aria-label="New agreement">
          <AgreementStudio onCreated={() => setRefreshKey((k) => k + 1)} />
        </section>
      )}

      <section className="mt-12" aria-label="Your agreements">
        <h2 className="text-base font-semibold text-ink mb-4">Your agreements</h2>
        <AgreementsPanel refreshKey={refreshKey} />
      </section>
    </div>
  );
}
