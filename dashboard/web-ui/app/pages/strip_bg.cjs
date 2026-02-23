const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if (file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('/Users/mora/Desktop/Dev-mac/rejourney/dashboard/web-ui/app/pages');

let modifiedCount = 0;
for (const file of files) {
    const originalContent = fs.readFileSync(file, 'utf8');
    let content = originalContent;
    
    content = content.replace(/className=["']([^"']*)min-h-screen([^"']*)["']/g, (match, prefix, suffix) => {
        let classes = `${prefix}min-h-screen${suffix}`;
        
        classes = classes.replace(/\bbg-[a-zA-Z]+-[0-9]+(\/[0-9]+)?\b/g, ''); 
        classes = classes.replace(/\bbg-white\b/g, '');
        classes = classes.replace(/\bbg-transparent\b/g, '');
        classes = classes.replace(/\bbg-gradient-to-b\b/g, '');
        classes = classes.replace(/\bfrom-[a-zA-Z]+-[0-9]+\b/g, ''); 
        classes = classes.replace(/\bto-[a-zA-Z]+-[0-9]+(\/[0-9]+)?\b/g, ''); 
        classes = classes.replace(/\bbg-\[radial-gradient[^\]]*\]\b/g, '');
        
        classes = classes.replace(/\s+/g, ' ').trim();
        classes = classes + ' bg-transparent';
        
        return `className="${classes.trim()}"`;
    });

    if (content !== originalContent) {
        fs.writeFileSync(file, content);
        modifiedCount++;
    }
}
console.log('Done cleaning backgrounds in ' + modifiedCount + ' files.');
