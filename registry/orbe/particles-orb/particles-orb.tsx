'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import {
  type OrbState,
  type OrbProps,
  hexToRgb,
  stateEnergy,
  approach,
  ERROR_COLOR_FROM,
  ERROR_COLOR_TO,
} from '@/registry/lib/orb-state';
import { useOrbLevel } from '@/registry/lib/use-orb-level';
import { observeActivity } from '@/registry/lib/use-in-view';

/* ─── constants ─── */
const TAU = Math.PI * 2;
const PARTICLE_COUNT = 120;
const BASE_ORBIT = 0.34;       // fraction of size
const ORBIT_SPREAD = 0.12;
const PARTICLE_MIN = 1;
const PARTICLE_MAX = 2.6;
const GLOW_ALPHA = 0.12;

interface Particle {
  angle: number;
  radius: number;      // orbit radius as fraction of half-size
  speed: number;       // radians per second
  size: number;
  phase: number;       // individual shimmer offset
  drift: number;       // radial drift amplitude
}

const makeParticles = (): Particle[] =>
  Array.from({ length: PARTICLE_COUNT }, () => ({
    angle: Math.random() * TAU,
    radius: BASE_ORBIT + (Math.random() - 0.5) * 2 * ORBIT_SPREAD,
    speed: (0.15 + Math.random() * 0.35) * (Math.random() > 0.5 ? 1 : -1),
    size: PARTICLE_MIN + Math.random() * (PARTICLE_MAX - PARTICLE_MIN),
    phase: Math.random() * TAU,
    drift: 0.01 + Math.random() * 0.04,
  }));

export function ParticlesOrb({
  state = 'idle',
  size = 128,
  speed = 0.5,
  colorFrom = '#94a3b8',
  colorTo = '#e2e8f0',
  levelRef,
  label,
  className,
  ref: externalRef,
}: OrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>(makeParticles());
  const clockRef = useRef(0);
  const smoothLevelRef = useRef(0);

  // Drive CSS vars for the level (used by useOrbLevel internally)
  useOrbLevel(containerRef, state, levelRef);

  // Resolve colors, switching to error palette when needed
  const fromRgb = hexToRgb(state === 'error' ? ERROR_COLOR_FROM : colorFrom);
  const toRgb = hexToRgb(state === 'error' ? ERROR_COLOR_TO : colorTo);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number) => {
      const t = clockRef.current;
      const energy = levelRef?.current != null && levelRef.current >= 0
        ? levelRef.current
        : stateEnergy(state, t);
      smoothLevelRef.current = approach(smoothLevelRef.current, energy, 6, dt);
      const level = smoothLevelRef.current;

      const cx = w / 2;
      const cy = h / 2;
      const half = Math.min(w, h) / 2;

      ctx.clearRect(0, 0, w, h);

      // Core glow
      const glowRadius = half * (0.18 + level * 0.14);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      const coreAlpha = GLOW_ALPHA + level * 0.16;
      glow.addColorStop(0, `rgba(${fromRgb[0]},${fromRgb[1]},${fromRgb[2]},${coreAlpha.toFixed(2)})`);
      glow.addColorStop(1, `rgba(${toRgb[0]},${toRgb[1]},${toRgb[2]},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, TAU);
      ctx.fill();

      // Particles
      const particles = particlesRef.current;
      const spd = speed;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.angle += p.speed * spd * dt;

        const breathe = level * 0.08;
        const radialOsc = Math.sin(t * 1.6 + p.phase) * p.drift * (1 + level * 2.5);
        const r = (p.radius + breathe + radialOsc) * half;

        const px = cx + Math.cos(p.angle) * r;
        const py = cy + Math.sin(p.angle) * r;

        // Particle shimmer
        const shimmer = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.8 + p.phase));
        const alpha = shimmer * (0.45 + level * 0.55);

        // Lerp color
        const mix = (i / particles.length + Math.sin(t * 0.4 + p.phase) * 0.15) % 1;
        const cr = Math.round(fromRgb[0] + (toRgb[0] - fromRgb[0]) * mix);
        const cg = Math.round(fromRgb[1] + (toRgb[1] - fromRgb[1]) * mix);
        const cb = Math.round(fromRgb[2] + (toRgb[2] - fromRgb[2]) * mix);

        const dotSize = p.size * (0.7 + level * 0.6);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.beginPath();
        ctx.arc(px, py, dotSize, 0, TAU);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    },
    [state, speed, fromRgb, toRgb, levelRef],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = size * dpr;
    const h = size * dpr;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last: number | null = null;
    let active = true;

    const frame = (now: number) => {
      raf = 0;
      const dt = last === null ? 0 : Math.min((now - last) / 1000, 0.1);
      last = now;
      clockRef.current += dt;
      draw(ctx, w, h, dt);
      if (active) raf = requestAnimationFrame(frame);
      else last = null;
    };

    const wake = () => { if (raf === 0) raf = requestAnimationFrame(frame); };
    const halt = () => { if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; } last = null; };

    const unobserve = observeActivity(container, (next) => {
      active = next;
      if (next) wake(); else halt();
    });

    // Respect reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Draw one static frame
      clockRef.current = 0;
      draw(ctx, w, h, 0);
    } else {
      wake();
    }

    return () => { halt(); unobserve(); };
  }, [size, draw]);

  // Sync external ref
  useEffect(() => {
    if (!externalRef) return;
    if (typeof externalRef === 'function') externalRef(containerRef.current);
    else if ('current' in externalRef) {
      (externalRef as React.MutableRefObject<HTMLDivElement | null>).current = containerRef.current;
    }
  }, [externalRef]);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label={label ?? `AI assistant, ${state}`}
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: size,
          height: size,
          display: 'block',
        }}
      />
    </div>
  );
}
