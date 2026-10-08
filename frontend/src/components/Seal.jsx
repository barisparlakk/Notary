import React, { useMemo } from 'react';
import { SEAL_INK, SEAL_VIEWBOX, curvePath, sealSpec, tickPath } from '../lib/seal';

const LABELS = {
  verified: 'Seal of the recorded file',
  altered: 'Seal of the file you checked, which differs from the record',
  pending: 'Seal of the agreed file, waiting for signatures',
  neutral: 'Seal of the file you checked',
};

/**
 * Mührün çizimi. `hash` verilmezse "henüz dosya yok" taslağı çizilir.
 * animate: mürekkep bir kez işlenir (azaltılmış harekette anında görünür).
 * demo: kesikli halka ve DEMO damgası; gerçek bir mühürle karıştırılamaz.
 */
export default function Seal({ hash, state = 'verified', size = 200, animate = false, demo = false, label }) {
  const color = SEAL_INK[state] || SEAL_INK.neutral;
  const drawn = useMemo(() => {
    if (!hash) return null;
    const spec = sealSpec(hash);
    return { ticks: tickPath(spec.ticks), curves: spec.curves.map((c) => ({ d: curvePath(c), rot: c.rot })) };
  }, [hash]);

  return (
    <svg
      viewBox={SEAL_VIEWBOX}
      width={size}
      height={size}
      role="img"
      aria-label={label || (hash ? LABELS[state] : 'Empty seal. It appears when you check a file.')}
      className="shrink-0"
    >
      {!drawn ? (
        <>
          <circle r="116" fill="none" stroke="#C2C7D4" strokeWidth="1.4" strokeDasharray="5 5" />
          <circle r="84" fill="none" stroke="#D9DCE5" strokeWidth="0.8" />
          <circle r="56" fill="none" stroke="#D9DCE5" strokeWidth="0.8" />
          <circle r="28" fill="none" stroke="#D9DCE5" strokeWidth="0.8" />
        </>
      ) : (
        <>
          <circle r="116" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={demo ? '5 4' : undefined} className={animate ? 'seal-fade' : undefined} />
          <circle r="111" fill="none" stroke={color} strokeWidth="0.6" className={animate ? 'seal-fade' : undefined} />
          <path d={drawn.ticks} stroke={color} strokeWidth="0.8" fill="none" className={animate ? 'seal-fade' : undefined} />
          {drawn.curves.map((c, i) => (
            <path
              key={i}
              d={c.d}
              transform={`rotate(${c.rot})`}
              fill="none"
              stroke={color}
              strokeWidth="0.55"
              opacity="0.85"
              pathLength={animate ? 1 : undefined}
              className={animate ? 'seal-ink' : undefined}
              style={animate ? { animationDelay: `${0.12 + i * 0.16}s` } : undefined}
            />
          ))}
          <circle r="14" fill="#fff" stroke={color} strokeWidth="0.8" />
          {demo && (
            <text y="5" textAnchor="middle" fontSize="13" fontWeight="700" fill={color} opacity="0.7" letterSpacing="2">DEMO</text>
          )}
        </>
      )}
    </svg>
  );
}
