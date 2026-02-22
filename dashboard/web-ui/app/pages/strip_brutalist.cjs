const fs = require('fs');
const path = require('path');

function walk(dir) {
    if (!fs.existsSync(dir)) return [];
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if (file.endsWith('.tsx') || file.endsWith('.ts')) {
                results.push(file);
            }
        }
    });
    return results;
}

const dirs = [
    '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/recordings',
    '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/crashes',
    '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/errors',
    '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/anrs',
    '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/issues'
];

let files = [];
dirs.forEach(d => {
    files = files.concat(walk(d));
});

let modifiedCount = 0;
for (const file of files) {
    const originalContent = fs.readFileSync(file, 'utf8');
    let content = originalContent;
    
    // Quick regex replacements over the entire file
    content = content.replace(/border-b-4 border-black/g, 'border-b border-slate-100/80');
    content = content.replace(/border-2 border-black/g, 'border border-slate-100/80');
    content = content.replace(/border-b-2 border-black/g, 'border-b border-slate-100/80');
    content = content.replace(/border-t-2 border-black/g, 'border-t border-slate-100/80');
    content = content.replace(/border-l-2 border-black/g, 'border-l border-slate-100/80');
    content = content.replace(/border-r-2 border-black/g, 'border-r border-slate-100/80');
    
    // For lone 'border-black' not covered above
    content = content.replace(/(?<!-)border-black(?!-)/g, 'border-slate-100/80');
    
    // Shadows
    content = content.replace(/!?shadow-\[[0-9]+px_[0-9]+px_0px_0px_rgba\([^)]+\)\]/g, 'shadow-sm ring-1 ring-slate-900/5');
    content = content.replace(/hover:shadow-\[[0-9]+px_[0-9]+px_0px_0px_rgba\([^)]+\)\]/g, 'hover:shadow-md');
    content = content.replace(/active:shadow-none/g, '');
    
    // Active states translations
    content = content.replace(/active:translate-[xy]-\[[0-9-]+px\]/g, '');
    content = content.replace(/active:translate-[xy]-[0-9]+/g, '');
    
    // Typography
    content = content.replace(/font-black/g, 'font-semibold');
    content = content.replace(/text-black/g, 'text-slate-900');
    
    // Backgrounds replacing pure black accents
    content = content.replace(/bg-black text-white/g, 'bg-slate-900 text-white');
    content = content.replace(/(?<!-)bg-black/g, 'bg-slate-900');
    
    // Some rounding (from tight to slightly more rounded)
    content = content.replace(/rounded-none/g, 'rounded-md');
    
    if (content !== originalContent) {
        fs.writeFileSync(file, content);
        modifiedCount++;
    }
}
console.log('Done cleaning brutalist styles in ' + modifiedCount + ' files.');
