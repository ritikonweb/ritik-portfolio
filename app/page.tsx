import GlassHero from "@/components/glass-hero";
import PortfolioSections from "@/components/portfolio-sections";
import ScrollReveal from "@/components/scroll-reveal";

export default function Home() {
  return (
    <main id="main-content" className="relative">
      <a className="skip-link" href="#about">Skip to portfolio content</a>
      <GlassHero />
      <PortfolioSections />
      <ScrollReveal />
    </main>
  );
}
