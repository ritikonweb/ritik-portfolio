import site from "@/content/site.json";
import LinkedInFeed from "@/components/linkedin-feed";

const external = { target: "_blank", rel: "noreferrer" } as const;
const formatIndex = (index: number) => String(index + 1).padStart(2, "0");
type IconName = "email" | "linkedin" | "calendar" | "resume";

function ContactIcon({ name }: { name: IconName }) {
  const paths = { email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>, linkedin: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 10v7M8 7v.01M12 17v-4a3 3 0 0 1 6 0v4M12 10v7" /></>, calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01" /></>, resume: <><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6" /></> };
  return <span className="contact-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg></span>;
}

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return <header className="section-heading"><p className="eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2></header>;
}

export default function PortfolioSections() {
  return <>
    <section id="about" className="content-section about-section" aria-labelledby="about-title"><div className="section-shell"><SectionHeading id="about-title" eyebrow="01 / About" title={site.identity.statement} /><div className="about-lead">{site.about.paragraphs.map((para) => <p key={para.slice(0, 24)}>{para}</p>)}</div></div></section>
    <section id="experience" className="content-section experience-section" aria-labelledby="experience-title"><div className="section-shell"><SectionHeading id="experience-title" eyebrow="02 / Experience" title={site.journey.title} /><div className="timeline">{site.journey.items.map((item) => { const focus = "focus" in item ? (item as { focus?: string }).focus : undefined; const points = "points" in item ? (item as { points?: string[] }).points : undefined; const description = "description" in item ? (item as { description?: string }).description : undefined; return <article key={`${item.organization}-${item.period}`} className="timeline-row"><time>{item.period}</time><div><p className="organization">{item.organization}</p><h3>{item.role}{focus ? <span className="role-sub">({focus})</span> : null}</h3></div>{points ? <ul className="timeline-points">{points.map((point) => <li key={point}>{point}</li>)}</ul> : <p>{description}</p>}</article>; })}</div></div></section>
    <section id="projects" className="content-section projects-section" aria-labelledby="projects-title"><div className="section-shell"><SectionHeading id="projects-title" eyebrow="03 / Projects" title={site.projects.title} /><div className="project-list">{site.projects.items.map((project, index) => <a key={project.name} href={project.url} {...external} className="project-row"><span>{formatIndex(index)}</span><span className="project-copy"><h3>{project.name}</h3><p>{project.description}</p></span><span aria-hidden="true">↗</span></a>)}</div></div></section>
    <section id="education" className="content-section education-section" aria-labelledby="education-title"><div className="section-shell"><SectionHeading id="education-title" eyebrow="04 / Education" title={site.education.title} /><div className="compact-list">{site.education.items.map((item) => <article key={item.degree}><time>{item.period}</time><div><h3>{item.degree}</h3><p>{item.institution}</p></div></article>)}</div></div></section>
    <footer id="contact" className="contact-section" aria-labelledby="contact-title"><div className="section-shell contact-layout"><div><p className="eyebrow">05 / Contact</p><h2 id="contact-title">{site.contact.title}</h2></div><nav aria-label="Contact links" className="contact-links"><a href={`mailto:${site.contact.email}`}><ContactIcon name="email" /><span>Email</span></a><a href={site.contact.linkedin} {...external}><ContactIcon name="linkedin" /><span>LinkedIn</span></a><a href={site.contact.calendar} {...external}><ContactIcon name="calendar" /><span>Book a conversation</span></a></nav></div><LinkedInFeed /></footer>
  </>;
}