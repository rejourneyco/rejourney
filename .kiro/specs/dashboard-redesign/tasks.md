# Implementation Plan: Dashboard Redesign (Neo-Brutalist)

## Overview

Migrate the dashboard shell to the Neo_Style design language by updating CSS variables, shell layout components, and shared UI components. All dashboard pages inherit the new look automatically through the shared components.

## Tasks

- [x] 1. Update global CSS variables and shell class overrides
  - In `styles/index.css`, update `--dashboard-canvas` to `#f4f4f5` and `--dashboard-card-border` to `#000000`
  - Replace `.dashboard-sidebar` rule: remove dark bg, add `border-right: 2px solid #000000`, `background: #ffffff !important`, `color: #0f172a !important`
  - Replace `.dashboard-card-surface` rule: `background: #ffffff`, `border: 2px solid #000000`, `border-radius: 0`, `box-shadow: 4px 4px 0 0 rgba(0,0,0,1)`
  - Replace `.dashboard-topbar` rule: `border-bottom: 2px solid #000000 !important`, `background: #ffffff !important`
  - Update `.dashboard-modern` accent overrides to map `bg-blue-600`, `border-blue-600`, `text-blue-600` to `#5dadec`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 10.5_

- [x] 2. Redesign `Sidebar.tsx` to Neo-Brutalist style
  - [x] 2.1 Update sidebar container and section label styles
    - Change sidebar background from `bg-[#0f172a]` to `bg-white`
    - Update section labels to `text-black font-bold uppercase tracking-wide border-b-2 border-black font-mono`
    - Update mobile backdrop from `bg-slate-900/50 backdrop-blur-sm` to `bg-black/40`
    - Update sidebar loading skeleton from `animate-pulse bg-slate-700/60` to `animate-pulse bg-gray-200`
    - Update empty project message from `text-slate-400` to `text-gray-500`
    - _Requirements: 2.1, 2.2, 1.4, 8.5_

  - [x] 2.2 Update nav item active and inactive states
    - Replace active item classes: remove sky-blue left accent bar, apply `bg-white border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] translate-x-[-1px]`
    - Replace active icon color from `text-sky-300` to `text-[#5dadec]`
    - Replace inactive item classes: `text-gray-600 hover:bg-gray-200 hover:border-gray-400`
    - Update collapsed desktop icon contrast from `text-sky-100` to `text-black` (inactive) and `text-[#5dadec]` (active)
    - _Requirements: 2.3, 2.4, 7.1, 7.2, 7.3, 10.2_

  - [x] 2.3 Update team/project switcher and collapse toggle
    - Update switcher buttons to `bg-white border-2 border-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - Update collapse toggle to `border-2 border-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - _Requirements: 2.6, 2.7, 2.8_

  - [ ]* 2.4 Write property test for active nav item visual tokens (Property 1)
    - **Property 1: Neo_Style active nav item contains required visual tokens**
    - Generate random nav item labels and active/inactive states; render `Sidebar`; assert active items have `border-black` and `shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]` and no `.sky-bar` element
    - `// Feature: dashboard-redesign, Property 1: Neo_Style active nav item contains required visual tokens`
    - **Validates: Requirements 2.3, 7.1**

  - [ ]* 2.5 Write property test for nav item icon color (Properties 2 & 3)
    - **Property 2+3: Nav item icon color matches active state**
    - Generate random nav items with random active states; assert active icon has `text-[#5dadec]` and inactive icon has `text-gray-600`
    - `// Feature: dashboard-redesign, Property 2+3: Nav item icon color matches active state`
    - **Validates: Requirements 2.4, 7.2, 7.3, 10.2**

  - [ ]* 2.6 Write property test for section labels (Property 4)
    - **Property 4: Section labels are uppercase mono**
    - Generate random section names; render `Sidebar` expanded; assert each section label has `uppercase` and `font-mono` classes
    - `// Feature: dashboard-redesign, Property 4: Section labels are uppercase mono`
    - **Validates: Requirements 1.4, 2.5**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Redesign `TopBar.tsx` to Neo-Brutalist style
  - [x] 4.1 Update TopBar container, project name, and badges
    - Update project name to `text-sm font-black font-mono uppercase tracking-wide text-black`
    - Update platform badges to `border-2 border-black bg-white text-black font-mono uppercase`
    - Update plan/usage badge to `border-2 border-black bg-white font-mono`
    - _Requirements: 3.1, 3.2, 3.6_

  - [x] 4.2 Update TopBar action buttons and user menu
    - Update copy key, AI Docs, and refresh (idle) buttons to `border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - Update refresh complete state to `bg-white border-2 border-[#34d399]` with `text-[#34d399]` icon
    - Update refresh active state to `bg-white border-2 border-[#5dadec]` with `text-[#5dadec]` icon
    - Update user menu button to `border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - Update user avatar to `bg-white border-2 border-black`
    - Update dropdown menu to `border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-none`
    - Update mobile menu toggle to `border-2 border-black bg-white`
    - _Requirements: 3.3, 3.4, 3.5, 10.3_

  - [ ]* 4.3 Write property test for TopBar refresh completion (Property 8)
    - **Property 8: TopBar refresh completion uses Accent_Blue**
    - Render `TopBar` with `refreshCompletedPulse=true`; assert refresh icon has `text-[#5dadec]`
    - `// Feature: dashboard-redesign, Property 8: TopBar refresh completion uses Accent_Blue`
    - **Validates: Requirements 3.5, 10.3**

- [x] 5. Redesign `DashboardPageHeader.tsx` to Neo-Brutalist style
  - [x] 5.1 Update PageHeader container, title, and icon container
    - Update container border from `border-b border-slate-100` to `border-b-2 border-black`
    - Update title to `text-xl md:text-2xl font-black font-mono uppercase tracking-wide text-black`
    - Update icon container from `rounded-xl border-slate-100 shadow-sm` to `border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] rounded-none`
    - Update any badge in the header to use `border-2 border-black` Neo_Style pattern
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 5.2 Write property test for PageHeader title typography (Property 9)
    - **Property 9: PageHeader title is uppercase mono**
    - Generate random title strings; render `DashboardPageHeader`; assert `h1` has `font-mono` and `uppercase` classes
    - `// Feature: dashboard-redesign, Property 9: PageHeader title is uppercase mono`
    - **Validates: Requirements 4.2, 1.1**

- [x] 6. Redesign `KpiCardsGrid.tsx` delta badges and card internals
  - [x] 6.1 Update KPI card label, value, and delta badge styles
    - Update card label to `text-xs font-mono font-semibold uppercase tracking-wide text-slate-500`
    - Update metric value to `text-[1.75rem] font-black font-mono text-black`
    - Update improving delta badge to `bg-white border-2 border-black text-[#34d399] font-mono font-bold`
    - Update declining delta badge to `bg-white border-2 border-black text-[#ef4444] font-mono font-bold`
    - Update flat/unknown delta badge to `bg-white border-2 border-black text-slate-500 font-mono font-bold`
    - Add hover-lift to card: `hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all`
    - Update controls panel to `border-2 border-black bg-white`
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 1.2, 1.3_

  - [ ]* 6.2 Write property test for KPI delta badge color (Property 5)
    - **Property 5: KPI card delta badge color matches trend direction**
    - Generate random `KpiCardItem` objects with random delta values and `betterDirection`; assert improving badge has `text-[#34d399]`, declining has `text-[#ef4444]`, both have `border-black`
    - `// Feature: dashboard-redesign, Property 5: KPI card delta badge color matches trend direction`
    - **Validates: Requirements 5.5, 5.6, 10.4**

  - [ ]* 6.3 Write property test for KPI card typography (Properties 6 & 7)
    - **Property 6+7: KPI card value and label typography**
    - Generate random `KpiCardItem` objects; assert value element has `font-mono font-black` and label element has `font-mono uppercase`
    - `// Feature: dashboard-redesign, Property 6+7: KPI card value and label typography`
    - **Validates: Requirements 5.3, 5.4, 1.3**

  - [ ]* 6.4 Write unit tests for KPI card edge cases
    - Test `delta.value === null` renders `N/A` badge with flat Neo_Style (white bg, black border, `text-slate-500`)
    - Test `delta.value === 0` renders flat badge
    - _Requirements: 5.5, 5.6_

- [x] 7. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Write property test for dashboard canvas background (Property 10)
  - [ ]* 8.1 Write property test for canvas background color
    - **Property 10: Dashboard canvas background is light neutral**
    - Render the dashboard shell; assert `dashboard-content` element computed background is `#f4f4f5` or `#ffffff`
    - `// Feature: dashboard-redesign, Property 10: Dashboard canvas background is light neutral`
    - **Validates: Requirements 6.1, 6.2**

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Apply Neo_Style to all inline KPI cards across dashboard pages
  - [x] 10.1 Update `features/app/shared/dashboard/KpiCardsGrid.tsx` controls panel selects and buttons
    - Update Trend/Sort select elements to `border-2 border-black bg-white font-mono text-xs rounded-none`
    - Update Customize button to `border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-mono uppercase text-xs`
    - Update Reset button to same Neo_Style
    - Update card visibility toggle labels to `border-2 border-black bg-white font-mono text-xs`
    - _Requirements: 5.1, 9.1, 9.4_

  - [x] 10.2 Find and update any remaining inline stat/KPI cards across all dashboard pages
    - Search for `bg-slate-50`, `border-slate-200`, `rounded-xl`, `rounded-lg` patterns in dashboard page files
    - Update any card containers in `general/`, `analytics/`, `stability/`, `alerts/`, `billing/` routes to use `border-2 border-black bg-white` Neo_Style
    - _Requirements: 9.2, 9.5_

- [x] 11. Apply Neo_Style to the Replays (Sessions) index page
  - [x] 11.1 Update search bar, filter controls, and issue filter pills
    - Search input: replace `border-slate-200 rounded-lg` with `border-2 border-black rounded-none font-mono`
    - Date filter input: replace soft border with `border-2 border-black rounded-none`
    - Advanced Filters button: replace `bg-indigo-50 border-indigo-300` active state with `bg-[#5dadec]/10 border-[#5dadec]`; idle state `border-2 border-black bg-white`
    - Clear All button: replace `border-red-200` with `border-2 border-black text-[#ef4444]`
    - Issue filter pills: replace `bg-slate-900 text-white` active with `bg-black text-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`; idle `border-2 border-black bg-white`
    - Export CSV button: replace `bg-slate-900` with `bg-black border-2 border-black hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - _Requirements: 9.2, 9.5_

  - [x] 11.2 Update sessions table container and rows
    - Table container: replace soft border/shadow with `border-2 border-black bg-white`
    - Table header row: replace `bg-slate-50 border-slate-200` with `bg-[#f4f4f5] border-b-2 border-black font-mono uppercase text-xs`
    - Table rows: replace `hover:bg-slate-50` with `hover:bg-gray-100 border-b border-gray-200`
    - Pagination controls: replace soft rounded buttons with `border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]` Neo_Style
    - Load More button: replace with Neo_Style `border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - _Requirements: 9.5_

- [x] 12. Apply Neo_Style to the Replay detail (session player) page
  - [x] 12.1 Update player chrome and controls
    - Player container/card: replace soft shadow/border with `border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]`
    - Back button: replace with `border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - Playback controls (play/pause/skip): replace rounded buttons with `border-2 border-black bg-white hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]`
    - Speed selector: replace with `border-2 border-black bg-white font-mono`
    - Progress bar: replace soft track with `border-2 border-black` track, `bg-[#5dadec]` fill
    - _Requirements: 9.2_

  - [x] 12.2 Update workbench tabs and panels
    - Tab bar: replace `border-b border-slate-200` with `border-b-2 border-black`
    - Active tab: replace `border-b-2 border-indigo-500 text-indigo-600` with `border-b-2 border-black text-black font-mono font-bold`
    - Inactive tab: replace `text-slate-500 hover:text-slate-700` with `text-gray-500 hover:text-black font-mono`
    - Timeline/Console/Inspector panels: replace soft card borders with `border-2 border-black bg-white`
    - Event badges (CRASH/ANR/ERROR): keep semantic colors but add `border-2 border-black` wrapper
    - Session metadata cards: replace `bg-slate-50 border-slate-200 rounded-lg` with `border-2 border-black bg-white`
    - _Requirements: 9.2_

- [x] 13. Final checkpoint after replays update
  - Ensure no regressions in replay functionality. Ask user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use **fast-check** with a minimum of 100 iterations per test
- Each property test is tagged with `// Feature: dashboard-redesign, Property N: <property_text>`
- The redesign is purely visual — no routing, data fetching, or business logic changes
