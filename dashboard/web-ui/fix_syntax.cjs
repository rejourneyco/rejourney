const fs = require('fs');

const files = [
  '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/crashes/CrashesList.tsx',
  '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/errors/ErrorsList.tsx',
  '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/anrs/ANRsList.tsx',
];

for (const f of files) {
  let content = fs.readFileSync(f, 'utf8');
  // Remove the rogue </div> that closes the card early
  content = content.replace(
    `                </div>\n                <div className="bg-white divide-y divide-slate-100">\n                    {f`,
    `                <div className="bg-white divide-y divide-slate-100">\n                    {f`
  );
  content = content.replace(
    `                </div>\n                <div className="bg-white divide-y divide-slate-100">\n                    {s`,
    `                <div className="bg-white divide-y divide-slate-100">\n                    {s`
  );
  fs.writeFileSync(f, content);
}

const recFile = '/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages/recordings/RecordingsList.tsx';
let recContent = fs.readFileSync(recFile, 'utf8');

// Fix RecordingsList
recContent = recContent.replace(
  `          </div>\n        </div>\n          </div>\n          <div className="bg-white divide-y divide-slate-100">`,
  `          </div>\n        </div>\n      </div>\n\n      {/* List Content */}\n      <div className="flex-1 max-w-[1800px] mx-auto w-full px-6 pt-6 pb-20">\n        <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden mt-6">\n          <div className="bg-white divide-y divide-slate-100">`
);
fs.writeFileSync(recFile, recContent);
console.log('Syntax fixed!');
