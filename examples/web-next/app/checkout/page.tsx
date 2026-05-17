import { PageCard } from '../page-card';

export default function CheckoutPage() {
  return (
    <main className="shell">
      <PageCard
        eyebrow="Checkout"
        title="Checkout flow"
        actions={[
          { href: '/pricing', label: 'Back to Pricing' },
          { href: '/account', label: 'Finish Checkout' },
        ]}
      >
        <p>
          Use this page to test form masking, route transitions, back/forward navigation,
          and same-tab session continuity.
        </p>
        <form className="fixture-form">
          <label>
            Work email
            <input type="email" placeholder="masked@example.com" />
          </label>
          <label>
            Company
            <input placeholder="Acme Labs" />
          </label>
          <label>
            Card note
            <textarea placeholder="This checkout note should be masked in replay" />
          </label>
        </form>
      </PageCard>
    </main>
  );
}
