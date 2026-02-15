# Task: Dashboard Title Unification

## Objective
Unify the title sections across all dashboard sub-pages into a single, clean, and consistent design using a reusable component.

## Changes Implemented

### 1. Created Reusable Component
- **File:** `app/components/ui/DashboardPageHeader.tsx`
- **Description:** A flexible header component that accepts `title`, `subtitle`, `icon`, and `children` (for filters/actions).
- **Style:** Clean white background with a bottom border, consistent typography, and layout.

### 2. Updated Dashboard Pages
Replaced custom header implementations with `DashboardPageHeader` in the following files:

- **Geo.tsx** (`app/pages/analytics/Geo.tsx`)
  - Title: "Geographic Reliability Intelligence"
  - Subtitle: "Visualize regional performance and user impact"
  - Updated background to `bg-slate-50`.

- **Devices.tsx** (`app/pages/analytics/Devices.tsx`)
  - Title: "Device Matrix"
  - Subtitle: "Track models, versions, and fragmentation"
  - Updated background to `bg-slate-50`.

- **RecordingsList.tsx** (`app/pages/recordings/RecordingsList.tsx`)
  - Title: "Session Archive"
  - Subtitle: "Browse, filter & replay user sessions"
  - updated background to `bg-slate-50`.

- **ApiAnalytics.tsx** (`app/pages/analytics/ApiAnalytics.tsx`)
  - Title: "API Reliability & Performance"
  - Subtitle: "Monitor endpoints, regions, and network conditions"
  - Updated background to `bg-slate-50`.

- **Growth.tsx** (`app/pages/analytics/Growth.tsx`)
  - Title: "Growth Intelligence"
  - Subtitle: "Connect acquisition metrics to reliability"
  - Updated background to `bg-slate-50`.

- **Journeys.tsx** (`app/pages/analytics/Journeys.tsx`)
  - Title: "User Journeys"
  - Subtitle: "Diagnostics for user divergence and failure"
  - Updated background to `bg-slate-50`.

- **AlertEmails.tsx** (`app/pages/analytics/AlertEmails.tsx`)
  - Title: "Alert Settings"
  - Subtitle: "Configure real-time notifications for critical events"
  - Updated background to `bg-slate-50`.

- **IssuesFeed.tsx** (`app/pages/IssuesFeed.tsx`)
  - Title: "Issues Feed"
  - Subtitle: "Live stream of detected anomalies"
  - Integrated Search and TimeFilter into the header.
  - Updated background to `bg-slate-50`.

## Outcome
All dashboard main pages now share a consistent, cleaner header design, improving the overall user experience and maintainability of the codebase.
