import { FixtureTestPanel } from './fixture-test-panel';
import { PageCard } from './page-card';

export default function Page() {
  return (
    <main className="shell">
      <PageCard
        eyebrow="Next.js App Router"
        title="Rejourney web replay fixture"
        actions={[
          { href: '/pricing', label: 'Pricing Page' },
          { href: '/checkout', label: 'Checkout Page' },
          { href: '/account', label: 'Account Page' },
        ]}
      >
        <p>
          This example starts the local web SDK from a Client Component and leaves input masking on.
        </p>
        <form>
          <label>
            Email
            <input type="email" placeholder="masked@example.com" />
          </label>
          <label>
            Plan
            <select defaultValue="pro">
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
            </select>
          </label>
          <button type="button">Trigger click analytics</button>
        </form>
      </PageCard>
      <FixtureTestPanel />
    </main>
  );
}
