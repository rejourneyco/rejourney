# Requirements Document

## Introduction

The dashboard currently uses a visually distinct style from the landing page and docs pages. The landing page and docs use a neo-brutalist design language: bold black 2px borders, hard drop shadows (`4px 4px 0 0 rgba(0,0,0,1)`), white backgrounds, uppercase mono typography (JetBrains Mono), and high-contrast accent colors (`#5dadec` sky blue, `#34d399` green, `#ef4444` red). The dashboard uses a dark slate-900 sidebar, soft rounded cards, a light gray canvas (`#f5f6f8`), and Inter font — a completely different visual vocabulary.

This feature redesigns the dashboard to share the same visual language as the landing and docs pages, creating a unified brand experience across the entire app. The scope covers: the sidebar, the top bar, the page header component, KPI/stat cards, and all individual dashboard pages.

## Glossary

- **Dashboard_Shell**: The persistent layout wrapper containing the Sidebar and TopBar (`AppLayout.tsx` / `ProjectLayout`).
- **Sidebar**: The left-hand navigation panel (`Sidebar.tsx`) containing team/project switchers and nav sections.
- **TopBar**: The horizontal bar at the top of the dashboard content area (`TopBar.tsx`).
- **PageHeader**: The per-page header component (`DashboardPageHeader.tsx` and `PageHeader.tsx`) rendered at the top of each dashboard page.
- **KPI_Card**: A metric display card showing a key performance indicator value, label, and optional trend delta (currently `StatCard.tsx` and inline `GA4Card` patterns).
- **Neo_Style**: The visual design language used on the landing and docs pages — bold 2px black borders, hard drop shadows, white backgrounds, uppercase mono fonts, and brand accent colors.
- **Landing_Page**: The public-facing home page at `/` (`features/public/home/route.tsx`).
- **Docs_Page**: The documentation pages at `/docs/*` (`features/public/docs/`).
- **Dashboard_Page**: Any authenticated route under `/dashboard/*` or `/demo/*`.
- **Accent_Blue**: The brand sky-blue color `#5dadec` used as the primary accent on the landing page.
- **Canvas**: The background surface of the dashboard content area.

---

## Requirements

### Requirement 1: Unified Typography System

**User Story:** As a user, I want the dashboard to use the same fonts and text styles as the landing and docs pages, so that the app feels like a single cohesive product.

#### Acceptance Criteria

1. THE Dashboard_Shell SHALL use JetBrains Mono as the primary monospace font for labels, badges, section headings, and metric values, matching the font used on the Landing_Page and Docs_Page.
2. THE Dashboard_Shell SHALL use uppercase tracking-wide letter-spacing for section labels, nav group headings, and KPI_Card titles, consistent with the Landing_Page heading style.
3. WHEN a KPI_Card title is rendered, THE KPI_Card SHALL display the title in uppercase monospace font with wide letter-spacing.
4. THE Sidebar SHALL render navigation section labels (e.g. "Monitor", "Analytics") in uppercase monospace font with wide letter-spacing.

---

### Requirement 2: Neo-Brutalist Sidebar

**User Story:** As a user, I want the sidebar to visually match the docs sidebar style, so that navigating the dashboard feels consistent with reading the documentation.

#### Acceptance Criteria

1. THE Sidebar SHALL use a white or light neutral background (`bg-white` or `bg-[#f4f4f5]`) instead of the current dark slate-900 background.
2. THE Sidebar SHALL use a bold 2px black right border (`border-r-2 border-black`) to separate it from the content area, matching the Docs_Page sidebar border style.
3. WHEN a navigation item is active, THE Sidebar SHALL highlight it with a white background, black border, and a hard drop shadow (`shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`) and a 1px left translate, matching the active link style in the Docs_Page sidebar.
4. WHEN a navigation item is inactive, THE Sidebar SHALL render it with no border and a hover state that applies a light gray background (`hover:bg-gray-200`) and a gray border, matching the Docs_Page sidebar hover style.
5. THE Sidebar navigation section labels SHALL be rendered as bold uppercase black text with a 2px black bottom border, matching the category header style in the Docs_Page sidebar.
6. THE Sidebar team and project switcher buttons SHALL use a white background with a 2px black border and a hard drop shadow on hover, matching the Neo_Style button pattern.
7. IF the sidebar is in collapsed state on desktop, THE Sidebar SHALL maintain the Neo_Style border and icon contrast against the light background.
8. THE Sidebar collapse/expand toggle button SHALL use the Neo_Style border and shadow pattern.

---

### Requirement 3: Neo-Brutalist TopBar

**User Story:** As a user, I want the top bar to visually match the landing page header, so that the dashboard header feels like a natural extension of the site header.

#### Acceptance Criteria

1. THE TopBar SHALL use a white background with a bold 2px black bottom border (`border-b-2 border-black`), matching the Landing_Page `Header` component border style.
2. THE TopBar project name SHALL be rendered in uppercase monospace font with bold weight, matching the Landing_Page nav link style.
3. THE TopBar action buttons (refresh, AI Docs, copy key) SHALL use the Neo_Style border pattern: 2px black border, white background, with a hard drop shadow on hover (`hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`).
4. THE TopBar user menu button SHALL use a 2px black border and white background, matching the Landing_Page "Log in" button style.
5. WHEN the refresh action completes successfully, THE TopBar SHALL display a brief visual confirmation using the Accent_Blue color (`#5dadec`).
6. THE TopBar platform badges (ios/android) SHALL use a 2px black border with white background and uppercase monospace text.

---

### Requirement 4: Neo-Brutalist Page Header

**User Story:** As a user, I want each dashboard page header to use the same bold, high-contrast style as the landing page section headers, so that page titles feel intentional and on-brand.

#### Acceptance Criteria

1. THE PageHeader SHALL use a white background with a bold 2px black bottom border, replacing the current soft `border-slate-100` border.
2. THE PageHeader title SHALL be rendered in uppercase, bold, black text using the monospace font, matching the Landing_Page feature section heading style.
3. THE PageHeader icon container SHALL use a 2px black border and a hard drop shadow (`shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`), replacing the current soft rounded shadow.
4. WHERE a badge is present in the PageHeader, THE PageHeader SHALL render the badge using the Neo_Style border pattern with a 2px black border.
5. THE PageHeader subtitle SHALL be rendered in a muted gray serif or sans-serif font, providing contrast against the bold title.

---

### Requirement 5: Neo-Brutalist KPI Cards

**User Story:** As a user, I want KPI cards to use the same bold card style as the landing page feature cards, so that key metrics stand out clearly and feel consistent with the brand.

#### Acceptance Criteria

1. THE KPI_Card SHALL use a white background with a bold 2px black border, replacing the current soft `border-slate-200` border.
2. THE KPI_Card SHALL display a hard drop shadow (`shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`), matching the Landing_Page feature image card shadow style.
3. THE KPI_Card metric value SHALL be rendered in a large, bold, black monospace font (font-black, font-mono), matching the Landing_Page hero number style.
4. THE KPI_Card title label SHALL be rendered in uppercase monospace font with wide letter-spacing.
5. WHEN a positive trend delta is present and positive is good, THE KPI_Card SHALL display the delta in the `#34d399` green accent color with a 2px black border badge.
6. WHEN a negative trend delta is present and positive is good, THE KPI_Card SHALL display the delta in the `#ef4444` red accent color with a 2px black border badge.
7. WHEN a KPI_Card is hovered, THE KPI_Card SHALL apply a subtle translate transform (`hover:-translate-x-0.5 hover:-translate-y-0.5`) and increase shadow depth, matching the Landing_Page hover-lift interaction.
8. THE KPI_Card icon, if present, SHALL be rendered in a container with a 2px black border and white background.

---

### Requirement 6: Consistent Canvas and Surface Colors

**User Story:** As a user, I want the dashboard background and card surfaces to use the same clean white and light neutral palette as the landing and docs pages, so that the overall feel is bright and consistent.

#### Acceptance Criteria

1. THE Canvas SHALL use a white (`#ffffff`) or very light neutral (`#f4f4f5`) background, replacing the current `#f5f6f8` gray canvas, to match the Docs_Page background.
2. THE Dashboard_Shell SHALL remove all dark-mode-only overrides from the `.dashboard-modern` CSS class that conflict with the Neo_Style color palette.
3. WHEN a dashboard card surface is rendered, THE Dashboard_Shell SHALL apply the `dashboard-card-surface` class with a white background and 2px black border, replacing the current soft border and shadow.
4. THE Dashboard_Shell SHALL update the `--dashboard-card-border` CSS variable to `#000000` (black) to reflect the Neo_Style border color.

---

### Requirement 7: Neo-Brutalist Navigation Active State Indicator

**User Story:** As a user, I want the active navigation item to be clearly indicated using the same bold style as the docs sidebar, so that I always know where I am in the dashboard.

#### Acceptance Criteria

1. WHEN a Sidebar navigation item is active, THE Sidebar SHALL remove the current sky-blue left accent bar and replace it with the Neo_Style active state: white background, 2px black border, hard drop shadow, and 1px left translate.
2. THE Sidebar active item icon SHALL use the Accent_Blue color (`#5dadec`) to provide a subtle brand color cue within the Neo_Style active state.
3. WHEN a Sidebar navigation item is inactive, THE Sidebar SHALL render the icon in a dark gray (`text-gray-600`) color against the light background.

---

### Requirement 8: Responsive Behavior Preservation

**User Story:** As a developer, I want the redesigned dashboard to maintain all existing responsive behaviors, so that mobile and tablet users are not negatively impacted by the visual changes.

#### Acceptance Criteria

1. WHEN the viewport width is below 768px, THE Sidebar SHALL continue to render as a slide-in drawer with a backdrop overlay, preserving the existing mobile behavior.
2. WHEN the viewport width is below 768px, THE TopBar SHALL continue to render the mobile menu toggle button.
3. THE Sidebar resize handle on desktop SHALL remain functional after the redesign.
4. THE Sidebar collapse/expand behavior on desktop SHALL remain functional after the redesign.
5. IF the sidebar is in mobile open state, THE Sidebar SHALL render with the Neo_Style light background and black borders, consistent with the desktop redesign.

---

### Requirement 9: All Individual Dashboard Pages Apply Neo Style

**User Story:** As a user, I want every dashboard page (General, Sessions, Analytics, Stability, Alerts, Settings, etc.) to use the Neo_Style card and layout patterns, so that the entire authenticated experience is visually consistent.

#### Acceptance Criteria

1. THE Dashboard_Shell SHALL provide updated shared CSS classes (`dashboard-card-surface`, `dashboard-content`) that all Dashboard_Page components inherit automatically, minimizing per-page changes.
2. WHEN any Dashboard_Page renders an inline card or panel, THE Dashboard_Page SHALL use the Neo_Style 2px black border and hard drop shadow pattern.
3. THE Dashboard_Shell SHALL update the `DashboardPageHeader` component so that all Dashboard_Pages that use it automatically receive the Neo_Style header without per-page modifications.
4. THE Dashboard_Shell SHALL update the `StatCard` / `KPI_Card` shared component so that all Dashboard_Pages that use it automatically receive the Neo_Style card without per-page modifications.
5. WHEN a Dashboard_Page renders a data table or list, THE Dashboard_Page SHALL use a 2px black border container with white background, consistent with the Neo_Style.

---

### Requirement 10: Brand Accent Color Consistency

**User Story:** As a user, I want interactive elements and highlights in the dashboard to use the same brand blue as the landing page, so that the color language is unified.

#### Acceptance Criteria

1. THE Dashboard_Shell SHALL use `#5dadec` (Accent_Blue) as the primary interactive accent color for focus rings, active indicators, and primary action buttons, replacing the current `sky-500`/`sky-600` Tailwind classes.
2. THE Sidebar active item icon SHALL use Accent_Blue (`#5dadec`) as its color.
3. THE TopBar refresh completion indicator SHALL use Accent_Blue.
4. THE KPI_Card positive trend badge SHALL use `#34d399` (brand green) as its background accent.
5. THE Dashboard_Shell SHALL update the `.dashboard-modern` CSS overrides to map `bg-blue-600` and related classes to Accent_Blue (`#5dadec`), ensuring consistency across all Dashboard_Pages.
