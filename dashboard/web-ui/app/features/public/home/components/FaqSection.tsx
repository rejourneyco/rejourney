import React, { useState } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';

interface FaqItem {
    question: string;
    answer: string;
}

const faqs: FaqItem[] = [
    {
        question: "How can Rejourney fix revenue leaks?",
        answer: "Rejourney uses a custom-built translation layer (our \"Rosetta Stone\") to parse and analyze your session replays at scale. An AI issue detector identifies the most critical user friction points affecting your checkout funnel and conversions. Rejourney then compiles these insights into a structured, LLM-optimized Markdown payload (.md file) that your developers can copy and paste directly into any AI coding agent (like Cursor, Claude, or Copilot) to automatically generate bug fixes and write verification test cases."
    },
    {
        question: "Can I filter sessions easily and only watch replays that matter, such as pre-churn sessions?",
        answer: "Yes, absolutely. Rejourney features an intuitive AI Query Builder and Smart Capture system. Instead of wading through hours of normal user sessions, you can target specific behavior indicators—such as users who repeatedly loop in the onboarding flow, trigger API exceptions right before abandoning their cart, or exhibit pre-churn indicators. Our filters allow you to isolate and view only the high-friction sessions that directly impact your conversion rates."
    },
    {
        question: "How easy is it to setup?",
        answer: "It's incredibly straightforward. You can easily get started by copying our AI Setup prompt from your Rejourney dashboard or developer documentation. It takes only a few lines of code to initialize the lightweight SDK on React Native, Next.js, Swift, Vue, or SvelteKit, and start capturing transaction-blocking bugs and rage-clicks out of the box."
    },
    {
        question: "Can I measure Rejourney's impact on fixing funnel leaks?",
        answer: "Yes. You can directly track changes and improvements over time using our visual User Journey mapping, real-time Revenue Tracking dashboards, and cohort performance graphs. By comparing historical drop-off rates against post-release conversion metrics, you can clearly measure recovered revenue and watch user sessions shift from frustrated loops to successful checkouts."
    },
    {
        question: "How much does it cost?",
        answer: "Rejourney is designed to be highly affordable for growth teams, offering a generous Free tier for up to 5,000 sessions/month. Paid tiers scale predictably based on your volume: Starter ($5/mo for 25k sessions), Growth ($15/mo for 100k sessions), Pro ($35/mo for 350k sessions), and Scale ($149/mo for 1m sessions). This volume-based pricing is significantly more cost-effective than standard legacy replay tools, and custom enterprise plans are available for volumes exceeding 1,000,000 monthly sessions."
    }
];

export const FaqSection: React.FC = () => {
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [copiedEmail, setCopiedEmail] = useState(false);

    const toggleFaq = (index: number) => {
        setOpenIndex(openIndex === index ? null : index);
    };

    const handleCopyEmail = async (e: React.MouseEvent) => {
        e.preventDefault();
        try {
            await navigator.clipboard.writeText('contact@rejourney.co');
            setCopiedEmail(true);
            setTimeout(() => setCopiedEmail(false), 2000);
        } catch (err) {
            console.error('Failed to copy email:', err);
        }
    };

    return (
        <section className="landing-section landing-faq-section relative z-10 overflow-hidden border-t border-slate-200/70 bg-transparent px-6 py-20 sm:px-8 sm:py-24 lg:px-12">
            <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_17%_21%,rgba(37,99,235,0.015),transparent_31%),radial-gradient(circle_at_82%_18%,rgba(16,185,129,0.015),transparent_32%),radial-gradient(circle_at_52%_86%,rgba(245,158,11,0.01),transparent_34%)]" aria-hidden="true" />
            <div className="relative z-10 mx-auto max-w-6xl">
                <div className="grid gap-10 lg:grid-cols-[0.8fr_1.4fr] lg:items-start">
                    
                    {/* Left Header Column - Clean Typography Hierarchy */}
                    <div className="space-y-5 text-left lg:sticky lg:top-24">
                        <div className="space-y-3">

                            <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-4xl">
                                Frequently Asked Questions
                            </h2>

                        </div>

                        {/* Minimalist support link instead of card */}
                        <div className="flex items-center gap-2 pt-1 text-sm font-medium text-slate-600">
                            <MessageSquare className="h-4 w-4 text-blue-600 shrink-0" />
                            <span>
                                Have specialized requirements?{' '}
                                <button onClick={handleCopyEmail} className="select-none font-bold text-blue-600 transition hover:underline">
                                    {copiedEmail ? 'Email copied!' : 'Contact engineering'}
                                </button>
                            </span>
                        </div>
                    </div>

                    {/* Right Column - quiet dashboard-style disclosure rows */}
                    <div className="flex flex-col gap-2.5">
                        {faqs.map((faq, index) => {
                            const isOpen = openIndex === index;
                            return (
                                <div 
                                    key={index}
                                    className={`rounded-xl border p-4 transition-colors duration-200 sm:p-5 ${
                                        isOpen
                                            ? 'border-indigo-200 bg-indigo-50/35 shadow-sm'
                                            : 'border-slate-200 bg-white shadow-sm hover:border-slate-300'
                                    }`}
                                >
                                    <button
                                        onClick={() => toggleFaq(index)}
                                        className="flex w-full items-start justify-between gap-6 text-left"
                                        aria-expanded={isOpen}
                                    >
                                        <span className="text-base font-bold leading-snug text-slate-900 sm:text-[1.05rem]">
                                            {faq.question}
                                        </span>
                                        <ChevronDown className={`mt-0.5 h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 ${
                                            isOpen ? 'rotate-180' : ''
                                        }`} />
                                    </button>
                                    
                                    {/* Pure CSS grid height transition container */}
                                    <div 
                                        className={`grid transition-all duration-300 ease-in-out ${
                                            isOpen ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'
                                        }`}
                                    >
                                        <div className="mt-1 overflow-hidden border-t border-slate-200 pt-4">
                                            <p className="pr-4 text-sm font-medium leading-6 text-slate-600 sm:text-[15px]">
                                                {faq.answer}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                </div>
            </div>
        </section>
    );
};
