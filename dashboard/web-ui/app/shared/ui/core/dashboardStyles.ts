/**
 * Class strings for the dashboard's look (the General page is the reference): flat white
 * cards on #f8fafd with 1px #dadce0 borders and square corners like the landing page,
 * Google greys, #1a73e8 as the only primary color, sentence case, and color only where it
 * carries status.
 */

export type DashboardButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type DashboardButtonSize = 'sm' | 'md' | 'lg';
export type DashboardChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple';

const buttonBase = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-none border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50';

export const dashboardButtonVariants: Record<DashboardButtonVariant, string> = {
    primary: 'border-[#1a73e8] bg-[#1a73e8] text-white hover:border-[#1765cc] hover:bg-[#1765cc]',
    secondary: 'border-[#dadce0] bg-white text-[#3c4043] hover:border-[#bdc1c6] hover:bg-[#f8fafd]',
    ghost: 'border-transparent bg-transparent text-[#3c4043] hover:bg-[#f1f3f4]',
    danger: 'border-[#d93025] bg-[#d93025] text-white hover:border-[#c5221f] hover:bg-[#c5221f]',
};

export const dashboardButtonSizes: Record<DashboardButtonSize, string> = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
    lg: 'h-10 px-5 text-sm',
};

export function dashboardButtonClass(variant: DashboardButtonVariant = 'secondary', size: DashboardButtonSize = 'md'): string {
    return `${buttonBase} ${dashboardButtonVariants[variant]} ${dashboardButtonSizes[size]}`;
}

export const dashboardChipTones: Record<DashboardChipTone, string> = {
    neutral: 'bg-[#f1f3f4] text-[#3c4043]',
    info: 'bg-[#e8f0fe] text-[#1967d2]',
    success: 'bg-[#e6f4ea] text-[#137333]',
    warning: 'bg-[#fef7e0] text-[#b06000]',
    danger: 'bg-[#fce8e6] text-[#c5221f]',
    purple: 'bg-[#f3e8fd] text-[#8430ce]',
};

export function dashboardChipClass(tone: DashboardChipTone = 'neutral'): string {
    return `inline-flex items-center gap-1 whitespace-nowrap rounded-none px-2 py-0.5 text-[11px] font-medium leading-4 ${dashboardChipTones[tone]}`;
}

/** Card surface; add padding at the call site. */
export const dashboardCardClass = 'rounded-none border border-[#dadce0] bg-white';

/** Text inputs and selects. */
export const dashboardFieldClass = 'h-9 w-full rounded-none border border-[#dadce0] bg-white px-3 text-sm text-[#202124] placeholder:text-[#80868b] focus:border-[#1a73e8] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/20 disabled:cursor-not-allowed disabled:bg-[#f8fafd] disabled:text-[#80868b]';

/** Small field or stat label. */
export const dashboardLabelClass = 'text-xs font-medium text-[#5f6368]';

/** Card and section headings. */
export const dashboardSectionTitleClass = 'text-[15px] font-medium text-[#202124]';

/** Selected segment, row or menu item. */
export const dashboardSelectedClass = 'bg-[#e8f0fe] text-[#1967d2]';
