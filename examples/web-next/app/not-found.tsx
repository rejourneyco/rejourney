import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">404</p>
        <h1>Missing fixture page</h1>
        <p>
          This route is deliberately missing. Use the browser Back button or the link below
          to verify the web SDK keeps the same tab session.
        </p>
        <div className="link-grid">
          <Link className="link-card" href="/">
            Back home
          </Link>
          <Link className="link-card" href="/checkout">
            Checkout
          </Link>
        </div>
      </section>
    </main>
  );
}
