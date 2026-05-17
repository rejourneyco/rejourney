import Link from 'next/link';
import type { ReactNode } from 'react';

type PageCardProps = {
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions?: Array<{ href: string; label: string }>;
};

export function PageCard({ eyebrow, title, children, actions = [] }: PageCardProps) {
  return (
    <section className="panel">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <div className="copy">{children}</div>
      {actions.length > 0 ? (
        <div className="link-grid">
          {actions.map((action) => (
            <Link key={action.href} className="link-card" href={action.href}>
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
