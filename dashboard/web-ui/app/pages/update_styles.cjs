const fs = require('fs');
const path = require('path');

const analyticsDir = '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/analytics';
const pagesDir = '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages';

const filesToTarget = [
    path.join(analyticsDir, 'Geo.tsx'),
    path.join(analyticsDir, 'Journeys.tsx'),
    path.join(analyticsDir, 'ApiAnalytics.tsx'),
    path.join(analyticsDir, 'Devices.tsx'),
    path.join(pagesDir, 'IssuesFeed.tsx'),
    path.join(pagesDir, 'GeneralOverview.tsx')
];

for (const file of filesToTarget) {
    if (!fs.existsSync(file)) {
        console.log('Not found:', file);
        continue;
    }

    let content = fs.readFileSync(file, 'utf8');
    let originalContent = content;

    // 1. Soften main section wrappers globally across these pages
    content = content.replace(/rounded-2xl border border-slate-200 bg-white/g, 'rounded-3xl border border-slate-100/80 bg-white ring-1 ring-slate-900/5');

    // 2. Soften inner info cards
    content = content.replace(/rounded-xl border border-slate-200 bg-slate-50/g, 'rounded-2xl border border-slate-100/80 bg-slate-50/50');
    content = content.replace(/rounded-lg border border-slate-200 bg-slate-50/g, 'rounded-xl border border-slate-100/80 bg-slate-50/50');
    content = content.replace(/rounded-xl border border-slate-200 p-3/g, 'rounded-2xl border border-slate-100/80 p-4'); // increase padding to p-4 sometimes

    // 3. Relax grid gaps to reduce cramped appearance
    content = content.replace(/grid grid-cols-1 gap-4/g, 'grid grid-cols-1 gap-6');
    content = content.replace(/grid grid-cols-2 gap-3/g, 'grid grid-cols-2 gap-5');

    // 4. KpiCardsGrid usages custom classes
    content = content.replace(/gridClassName="grid grid-cols-2 gap-4/g, 'gridClassName="grid grid-cols-2 gap-5');

    // 5. IssuesFeed specific NeoCard overrides
    content = content.replace(/NeoCard className="border-slate-200 bg-white"/g, 'NeoCard className="border-slate-100/80 bg-white ring-1 ring-slate-900/5"');
    content = content.replace(/NeoCard className="xl:col-span-2 border-slate-200 bg-white"/g, 'NeoCard className="xl:col-span-2 border-slate-100/80 bg-white ring-1 ring-slate-900/5"');

    // 6. Device specific colored cards
    content = content.replace(/border-amber-200 bg-amber-50\/40/g, 'border-amber-100/80 bg-amber-50/30 ring-1 ring-amber-900/5');
    content = content.replace(/border-rose-200 bg-rose-50\/35/g, 'border-rose-100/80 bg-rose-50/20 ring-1 ring-rose-900/5');

    if (content !== originalContent) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('Updated:', path.basename(file));
    }
}
