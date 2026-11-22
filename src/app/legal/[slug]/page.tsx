import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPolicy, policies } from "@/components/landing/policies";
import { SiteFooter, SiteHeader } from "@/components/landing/site-shell";

type LegalPageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return Object.keys(policies).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: LegalPageProps): Promise<Metadata> {
  const policy = getPolicy((await params).slug);
  return policy ? { title: policy.title, description: policy.intro, robots: { index: false, follow: true } } : {};
}

export default async function LegalPage({ params }: LegalPageProps) {
  const policy = getPolicy((await params).slug);
  if (!policy) notFound();

  return (
    <div className="fs-site">
      <a className="fs-skip-link" href="#main-content">Skip to content</a>
      <SiteHeader />
      <main id="main-content" className="fs-legal">
        <Link className="fs-text-link" href="/"><ArrowLeft size={16} aria-hidden="true" /> Back to Flight Share</Link>
        <div>
          <p className="fs-kicker fs-section-kicker"><span /> FLIGHT SHARE POLICIES</p>
          <h1>{policy.title}</h1>
          <p className="fs-legal-intro">{policy.intro}</p>
          <p className="fs-legal-note"><strong>Draft for this demo.</strong> These pages are placeholders. The operator must publish reviewed policies and contact details before a public launch.</p>
        </div>
        {policy.sections.map(({ title, text }) => (
          <section key={title}><h2>{title}</h2><p>{text}</p></section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}