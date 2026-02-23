const fs = require('fs');

const filesToFix = [
  'recordings/RecordingsList.tsx',
  'crashes/CrashesList.tsx',
  'errors/ErrorsList.tsx',
  'anrs/ANRsList.tsx',
];

for (const file of filesToFix) {
  const fullPath = '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/' + file;
  let content = fs.readFileSync(fullPath, 'utf8');

  if (file === 'recordings/RecordingsList.tsx') {
    content = content.replace(
      `<div className="bg-white border-b border-slate-100/80">\n          <div className="max-w-[1800px] mx-auto w-full px-6">\n            <div className="flex items-center py-2 text-xs font-semibold text-slate-900 uppercase tracking-wider gap-2">`,
      `<div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">\n          <div className="bg-slate-50 border-b border-slate-200">\n            <div className="flex items-center py-3 px-6 text-[11px] font-semibold text-slate-500 uppercase tracking-wider gap-2">`
    );
    
    content = content.replace(
      `      </div>\n\n      {/* List Content */}\n      <div className="flex-1 max-w-[1800px] mx-auto w-full px-6 pt-6 pb-20">\n        <div className="bg-white">`,
      `          </div>\n          <div className="bg-white divide-y divide-slate-100">`
    );
    
    content = content.replace(
      `        {/* Pagination for filtered/sorted results */}`,
      `        </div>\n        </div>\n\n        {/* Pagination for filtered/sorted results */}`
    );
  } else {
    content = content.replace(
      `                {/* Table Header */}\n                <div className="sticky top-[73px] z-40 bg-white border-b border-slate-100/80 px-6">\n                    <div className="flex items-center py-2 text-[10px] font-semibold text-slate-900 uppercase tracking-wider gap-4">`,
      `                <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">\n                {/* Table Header */}\n                <div className="bg-slate-50 border-b border-slate-200 px-6">\n                    <div className="flex items-center py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider gap-4">`
    );
    content = content.replace(
      `                {/* Table Header */}\n                <div className="sticky top-[90px] z-40 bg-white border-b border-slate-100/80 px-6">\n                    <div className="flex items-center py-2 text-[10px] font-semibold text-slate-900 uppercase tracking-wider gap-4">`,
      `                <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">\n                {/* Table Header */}\n                <div className="bg-slate-50 border-b border-slate-200 px-6">\n                    <div className="flex items-center py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider gap-4">`
    );
    
    content = content.replace(
      `                <div className="bg-white">\n                    {f`,
      `                </div>\n                <div className="bg-white divide-y divide-slate-100">\n                    {f`
    );
    content = content.replace(
      `                <div className="bg-white">\n                    {s`,
      `                </div>\n                <div className="bg-white divide-y divide-slate-100">\n                    {s`
    );

    content = content.replace(
      `                    })}\n                </div>\n            </div>`,
      `                    })}\n                </div>\n              </div>\n            </div>`
    );
  }

  content = content.replace(/className={`border-b border-slate-100 transition-all/g, "className={`transition-all");
  content = content.replace(/className={`border-b border-slate-100\/80 transition-all mb-2/g, "className={`transition-all");
  
  content = content.replace(/shadow-sm ring-1 ring-slate-900\/5/g, 'shadow-sm border border-slate-200');

  fs.writeFileSync(fullPath, content);
}
console.log('Lists fixed!');
