import React from 'react';
import { Smartphone, Zap, Server } from 'lucide-react';

export const ValuePropositionBlocks: React.FC = () => {
    const blocks = [
        {
            icon: Smartphone,
            title: "Lightweight SDK",
            description: "A lightweight native module, not a bloated web wrapper. Rejourney won't inflate your app bundle or tank your startup time."
        },
        {
            icon: Zap,
            title: "Dirt Cheap",
            description: "Pay per recorded minute, not per user or event. At 500k minutes, you pay ~$125/mo. PostHog? 10x more. No seat tax. No hidden fees."
        },
        {
            icon: Server,
            title: "Full Platform",
            description: "Session replay, analytics, crash reporting, heatmaps — all in one SDK. Self-host everything or use our managed cloud."
        }
    ];

    return (
        <section className="container mx-auto px-4 py-24 border-t-2 border-black">
            <div className="grid md:grid-cols-3 gap-8">
                {blocks.map((block, idx) => (
                    <div key={idx} className="bg-white p-8 border-l-4 border-black hover:bg-gray-50 transition-colors">
                        <block.icon size={48} className="mb-6 stroke-1" />
                        <h3 className="text-2xl font-black uppercase mb-4 leading-none">{block.title}</h3>
                        <p className="font-mono text-gray-700 leading-relaxed text-sm">
                            {block.description}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
};
