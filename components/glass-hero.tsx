"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import posthog from "posthog-js";
import site from "@/content/site.json";
import VoiceWidget from "@/components/voice-widget";

const DESKTOP_RADIUS = 235;
const MOBILE_RADIUS = 250;

export default function GlassHero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const rawPosition = useRef({ x: -999, y: -999 });
  const smoothedPosition = useRef({ x: -999, y: -999 });
  const currentRadius = useRef(0);
  const targetRadius = useRef(0);
  const touchState = useRef(false);
  const frameId = useRef<number | null>(null);
  const reducedMotion = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const element = heroRef.current;
    if (!element) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => { reducedMotion.current = media.matches; };
    syncMotion();
    media.addEventListener("change", syncMotion);
    const animate = () => {
      const positionFactor = reducedMotion.current ? 1 : 0.14;
      const radiusFactor = reducedMotion.current ? 1 : 0.12;
      smoothedPosition.current.x += (rawPosition.current.x - smoothedPosition.current.x) * positionFactor;
      smoothedPosition.current.y += (rawPosition.current.y - smoothedPosition.current.y) * positionFactor;
      currentRadius.current += (targetRadius.current - currentRadius.current) * radiusFactor;
      element.style.setProperty("--reveal-x", `${smoothedPosition.current.x}px`);
      element.style.setProperty("--reveal-y", `${smoothedPosition.current.y}px`);
      element.style.setProperty("--reveal-radius", `${currentRadius.current}px`);
      frameId.current = window.requestAnimationFrame(animate);
    };
    frameId.current = window.requestAnimationFrame(animate);
    return () => { media.removeEventListener("change", syncMotion); if (frameId.current !== null) window.cancelAnimationFrame(frameId.current); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("scroll", close, { passive: true });
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("touchmove", close, { passive: true });
    window.addEventListener("resize", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("scroll", close); window.removeEventListener("wheel", close); window.removeEventListener("touchmove", close); window.removeEventListener("resize", close); document.removeEventListener("keydown", closeOnEscape); };
  }, [menuOpen]);

  const setPoint = (event: ReactPointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); rawPosition.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse") { setPoint(event); targetRadius.current = DESKTOP_RADIUS; } };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse" || touchState.current) setPoint(event); };
  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType === "mouse") targetRadius.current = 0; };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") { touchState.current = true; event.currentTarget.setPointerCapture(event.pointerId); setPoint(event); targetRadius.current = MOBILE_RADIUS; } };
  const endTouch = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") { touchState.current = false; targetRadius.current = 0; } };

  return (
    <section className="glass-hero" aria-labelledby="hero-title">
      <header className="hero-header">
        <nav aria-label="Primary navigation" className="hero-nav">
          <a className="brand" href="#main-content" aria-label={`${site.identity.name}, back to top`}>{site.identity.name}</a>
          <button className="menu-toggle" type="button" aria-expanded={menuOpen} aria-controls="primary-links" aria-label={menuOpen ? "Close navigation" : "Open navigation"} onClick={() => setMenuOpen((open) => !open)}><span /><span /></button>
          <div id="primary-links" className={`nav-links${menuOpen ? " is-open" : ""}`}>{site.navigation.map((item) => <a key={item.href} href={item.href} onClick={() => { setMenuOpen(false); posthog.capture("nav_item_clicked", { label: item.label, href: item.href }); }}>{item.label}</a>)}</div>
        </nav>
      </header>

      <div className="hero-stage">
        <div className="hero-copy">
          <h1 id="hero-title" className="hero-heading" aria-label={site.hero.headingLines.join(" ")}>{site.hero.headingLines.map((line, index) => <span aria-hidden="true" key={`${line}-${index}`}>{line}</span>)}</h1>
          <div className="hero-actions"><a className="pill-button" href={site.contact.resume} target="_blank" rel="noreferrer" onClick={() => posthog.capture("resume_downloaded")}>{site.hero.primaryAction}</a><VoiceWidget /></div>
        </div>
        <div ref={heroRef} className="hero-media" onContextMenu={(e) => e.preventDefault()} onPointerEnter={handlePointerEnter} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} onPointerDown={handlePointerDown} onPointerUp={endTouch} onPointerCancel={endTouch}>
          <img className="portrait-layer base-portrait" src="/images/Base_image_desktop.webp" width="1672" height="941" alt="Portrait of Ritik Yadav" fetchPriority="high" decoding="async" draggable={false} />
          {/* Decorative: this is the second portrait revealed under the cursor, so
              aria-hidden keeps it out of the accessibility tree and the portrait is
              announced once, from the base layer above. Empty alt is the textbook
              treatment for that, but crawlers report it as a missing attribute and the
              false positive buries real ones. aria-hidden means the alt is never
              announced, so describing it costs nothing and silences the noise. */}
          <img className="portrait-layer reveal-portrait" src="/images/Reveal_image_desktop.webp" width="1672" height="941" alt="Ritik Yadav, second portrait revealed on hover" aria-hidden="true" fetchPriority="low" decoding="async" draggable={false} />
          <div className="technical-layer" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}