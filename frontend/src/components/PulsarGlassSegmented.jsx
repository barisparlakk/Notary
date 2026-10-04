import React, { useEffect, useRef } from 'react';
import PulsarGlass from '../lib/pulsar-glass.js';
import '../lib/pulsar-glass.css';

/**
 * PulsarGlassSegmented
 * 
 * Ultra-premium 120 FPS Apple-grade Liquid Glass Segmented Slider.
 * Adheres strictly to the Pulsar Glass engineering blueprint (Mustafa Tıraş).
 *
 * Features:
 * - 6-layer optical crown glass lens simulation
 * - Apple Quintic Ease-Out flight curve & mid-flight volumetric arc
 * - Nonlinear rubber-band overdrag resistance & magnetic spring snap
 * - Chromatic aberration & underwater label displacement SVG filters
 * - 0ms zero-latency onSelect dispatch
 * - Multi-frame subpixel measurement settling for dynamic layouts
 */
export default function PulsarGlassSegmented({
  options = [],
  value = '',
  onChange = () => {},
  size = 'md',
  theme = 'light',
  className = '',
}) {
  const trackRef = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!trackRef.current) return;

    // Initialize Pulsar Glass instance
    const inst = PulsarGlass.create(trackRef.current, {
      enableRefraction: true,
      enableWaterRefraction: true,
      flightDurationBase: 310,
      flightDurationScale: 0.35,
      maxOvershoot: 44,
      pullResistance: 110,
      onSelect: (_idx, val) => {
        if (val !== undefined && val !== null) {
          onChange(String(val));
        }
      },
    });

    instanceRef.current = inst;

    // Rule 6: Subpixel measurement settling for initial rendering
    const settle = () => {
      if (inst && typeof inst.refresh === 'function') {
        inst.refresh();
      }
    };

    const f1 = requestAnimationFrame(settle);
    const t1 = setTimeout(settle, 40);
    const t2 = setTimeout(settle, 120);
    const t3 = setTimeout(settle, 300);

    return () => {
      cancelAnimationFrame(f1);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      if (instanceRef.current) {
        instanceRef.current.destroy();
        instanceRef.current = null;
      }
    };
  }, []);

  // Update slider position when active value changes externally
  useEffect(() => {
    if (instanceRef.current && value) {
      instanceRef.current.selectByValue(value, true);
    }
  }, [value]);

  const sizeClass = size === 'sm' ? 'pg-sm' : size === 'lg' ? 'pg-lg' : '';

  return (
    <div
      ref={trackRef}
      className={`pg-track ${sizeClass} ${className}`}
      data-pg-theme={theme}
      role="tablist"
      aria-orientation="horizontal"
    >
      {/* 6-layer optical liquid glass lens */}
      <div className="pg-slider" aria-hidden="true" />

      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`pg-btn ${isActive ? 'active' : ''}`}
            data-value={opt.value}
            role="tab"
            aria-selected={isActive}
            aria-label={opt.label}
          >
            <span className="pg-label">
              {opt.icon && (
                <span className="inline-flex items-center justify-center mr-1.5 shrink-0 opacity-80" aria-hidden="true">
                  {opt.icon}
                </span>
              )}
              <span className="font-semibold tracking-tight">{opt.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
