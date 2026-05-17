import { PageCard } from '../page-card';

export default function AccountPage() {
  return (
    <main className="shell">
      <PageCard
        eyebrow="Account"
        title="Account workspace"
        actions={[
          { href: '/', label: 'Return Home' },
          { href: '/pricing', label: 'Change Plan' },
          { href: '/missing-fixture-page', label: 'Open 404' },
        ]}
      >
        <p>
          This route is intentionally simple so browser replay should show a clean page transition
          and preserve the same SDK session when you use the browser Back button.
        </p>
        <div className="status-grid">
          <div>
            <span>Seats</span>
            <strong>12</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>Active</strong>
          </div>
          <div>
            <span>Region</span>
            <strong>US</strong>
          </div>
        </div>
      </PageCard>
    </main>
  );
}
