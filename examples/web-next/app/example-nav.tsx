'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Home' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/checkout', label: 'Checkout' },
  { href: '/account', label: 'Account' },
  { href: '/missing-fixture-page', label: '404 test' },
];

export function ExampleNav() {
  const pathname = usePathname();

  return (
    <nav className="top-nav" aria-label="Example pages">
      <div className="nav-inner">
        <Link className="brand-link" href="/">
          Rejourney Next Fixture
        </Link>
        <div className="nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              className={pathname === link.href ? 'nav-link active' : 'nav-link'}
              href={link.href}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
