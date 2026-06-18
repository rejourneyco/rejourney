import React, { useState } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import { Link } from 'react-router';

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
        <section className="relative overflow-hidden border-t border-transparent bg-transparent px-6 py-24 sm:px-8 sm:py-32 lg:px-12">
            <div className="relative z-10 mx-auto max-w-7xl">
                <div className="grid gap-12 lg:grid-cols-[1.1fr_1.9fr] lg:items-start">
                    
                    {/* Left Header Column - Clean Typography Hierarchy */}
                    <div className="lg:sticky lg:top-28 space-y-5 text-left">
                        <div className="space-y-3">

                            <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl leading-[1.1]">
                                Frequently Asked Questions
                            </h2>

                        </div>

                        {/* Minimalist support link instead of card */}
                        <div className="pt-2 text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
                            <span>
                                Have specialized requirements?{' '}
                                <button onClick={handleCopyEmail} className="text-blue-600 font-bold hover:underline transition select-none">
                                    {copiedEmail ? 'Email copied!' : 'Contact engineering'}
                                </button>
                            </span>
                        </div>
                    </div>

                    {/* Right Column - Clean separated lines, no boxes/pills */}
                    <div className="divide-y divide-slate-100 border-t border-b border-slate-100">
                        {faqs.map((faq, index) => {
                            const isOpen = openIndex === index;
                            return (
                                <div 
                                    key={index}
                                    className="py-5 sm:py-6 transition-all duration-300"
                                >
                                    <button
                                        onClick={() => toggleFaq(index)}
                                        className="flex w-full items-start justify-between gap-6 text-left"
                                        aria-expanded={isOpen}
                                    >
                                        <span className={`text-base font-bold tracking-tight transition-colors duration-250 ${
                                            isOpen ? 'text-blue-600' : 'text-slate-900 hover:text-blue-600'
                                        }`}>
                                            {faq.question}
                                        </span>
                                        <ChevronDown className={`h-5 w-5 shrink-0 mt-0.5 text-slate-400 transition-all duration-300 ${
                                            isOpen ? 'rotate-180 text-blue-600' : ''
                                        }`} />
                                    </button>
                                    
                                    {/* Pure CSS grid height transition container */}
                                    <div 
                                        className={`grid transition-all duration-300 ease-in-out ${
                                            isOpen ? 'grid-rows-[1fr] opacity-100 mt-3.5' : 'grid-rows-[0fr] opacity-0'
                                        }`}
                                    >
                                        <div className="overflow-hidden">
                                            <p className="text-sm font-medium leading-relaxed text-slate-500 pr-6">
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
