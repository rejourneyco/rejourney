const fs = require('fs');
const file = 'dashboard/web-ui/app/shell/components/layout/Sidebar.tsx';
let data = fs.readFileSync(file, 'utf-8');

data = data.replace(
    /className="fixed left-0 top-0 bottom-0 isolate z-40 bg-white flex flex-col border-r border-[#E2E8F0] shadow-sm transition-all duration-300 ease-in-out font-['Inter',_sans-serif]"/g,
    `className="fixed left-0 top-0 bottom-0 isolate z-40 bg-zinc-50 border-r-4 border-black font-['Space_Grotesk',_sans-serif] shadow-neo-sm-right transition-all duration-300 ease-in-out"`
);

data = data.replace(
    /className="flex items-center gap-2(\\\.5)? p-2 text-sm text-\[#475569\] rounded-md hover:bg-\[#F1F5F9\] hover:text-\[#0F172A\] transition-colors"/g,
    `className="group flex items-center gap-3 px-3 py-2.5 text-[0.85rem] font-bold tracking-wide uppercase text-black/70 border-2 border-transparent hover:border-black hover:bg-black hover:text-white rounded-none transition-all"`
);

data = data.replace(
    /className="shrink-0 text-\[#64748B\] w-4 h-4"/g,
    `className="shrink-0 text-current w-5 h-5 group-hover:text-white transition-colors"`
);

data = data.replace(
    /text-xs font-semibold text-\[#94A3B8\] uppercase tracking-wider mb-2 px-3/g,
    `text-[10px] font-black underline decoration-2 decoration-black/20 underline-offset-4 text-black uppercase tracking-widest mb-3 px-3`
);

data = data.replace(
    /text-\[#0F172A\] bg-\[#E2E8F0\] font-medium/g,
    `text-white bg-black border-2 border-black`
);

fs.writeFileSync(file, data);
