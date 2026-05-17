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
          This example starts the local web SDK from a Client Component and includes
          secure and non-secure fields for replay privacy checks.
        </p>
        <form>
          <label>
            Display name
            <input type="text" placeholder="Alex Morgan" />
          </label>
          <label>
            Email
            <input type="email" placeholder="masked@example.com" />
          </label>
          <label>
            Password
            <input type="password" placeholder="super-secret-password" />
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
