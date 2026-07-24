"use client";

import { useEffect } from "react";

const SELECTOR = [
  ".content-section .section-heading",
  ".about-lead > p",
  ".timeline-row",
  ".project-row",
  ".compact-list > article",
  "#contact .contact-layout > div",
  ".contact-links > a",
  ".footer-line",
].join(",");

export default function ScrollReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    if (elements.length === 0) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      elements.forEach((el) => el.classList.add("reveal-item", "is-visible"));
      return;
    }

    elements.forEach((el) => el.classList.add("reveal-item"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -2% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return null;
}
