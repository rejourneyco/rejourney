import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ExampleNav } from './example-nav';
import { RejourneyClient } from './rejourney-client';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rejourney Web Next Example',
  description: 'Next.js fixture for @rejourneyco/web',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <RejourneyClient />
        <ExampleNav />
        {children}
      </body>
    </html>
  );
}
