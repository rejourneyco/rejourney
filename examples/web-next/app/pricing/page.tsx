import { PageCard } from '../page-card';

export default function PricingPage() {
  return (
    <main className="shell">
      <PageCard
        eyebrow="Pricing"
        title="Plan selection"
        actions={[
          { href: '/checkout?plan=starter', label: 'Choose Starter' },
          { href: '/checkout?plan=pro', label: 'Choose Pro' },
          { href: '/account', label: 'View Account' },
        ]}
      >
        <p>
          This page gives the replay a normal client-side navigation target with query strings,
          repeated controls, and scannable plan content.
        </p>
        <div className="plan-grid">
          <div>
            <span>Starter</span>
            <strong>$29</strong>
          </div>
          <div>
            <span>Pro</span>
            <strong>$99</strong>
          </div>
          <div>
            <span>Enterprise</span>
            <strong>Custom</strong>
          </div>
        </div>
      </PageCard>
    </main>
  );
}
