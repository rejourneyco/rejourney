/**
 * Rejourney Dashboard - Attributions Route
 */

import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";

export const meta: Route.MetaFunction = () => [
    { title: "Attributions - Rejourney" },
    {
        name: "description",
        content: "Third-party notices, trademark references, and attribution details for Rejourney.",
    },
    { name: "robots", content: "index, follow" },
    { property: "og:title", content: "Attributions - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/attributions" },
    { tagName: "link", rel: "canonical", href: "https://rejourney.co/attributions" },
];

export default function Attributions() {
    return (
        <div className="public-readable-scope min-h-screen bg-[var(--dashboard-canvas,#f8fafd)] text-[#202124]">
            <Header />
            <main className="container mx-auto max-w-4xl px-6 py-16">
                <h1 className="mb-3 text-4xl font-extrabold tracking-tight text-[#202124]">Attributions</h1>
                <p className="mb-8 text-sm font-medium text-[#5f6368]">Last Updated: June 4, 2026</p>

                <div className="space-y-6 rounded-none border border-[#dadce0] bg-white p-8 text-sm leading-relaxed text-[#3c4043] shadow-sm">
                    <section className="space-y-3">
                        <h2 className="text-base font-semibold">Brand Icons</h2>
                        <p>
                            Some browser and platform icons in Rejourney are used only to identify the browser,
                            operating system, or platform associated with a session. Brand names, logos, and marks
                            remain the property of their respective owners.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-semibold">Simple Icons</h2>
                        <p>
                            Browser mark SVG paths are sourced from{" "}
                            <a
                                href="https://simpleicons.org/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                Simple Icons
                            </a>{" "}
                            version 16.22.0. Simple Icons is distributed under the{" "}
                            <a
                                href="https://creativecommons.org/publicdomain/zero/1.0/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                CC0 1.0 Universal public domain dedication
                            </a>
                            , except where an individual icon lists a different license.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-semibold">Android</h2>
                        <p>
                            The Android robot mark is reproduced from Google&apos;s shared Android artwork and used
                            under the{" "}
                            <a
                                href="https://creativecommons.org/licenses/by/3.0/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                Creative Commons Attribution 3.0 License
                            </a>
                            . Android is a trademark of Google LLC.
                        </p>
                        <p>
                            Android brand guidance is available from{" "}
                            <a
                                href="https://developer.android.com/distribute/marketing-tools/brand-guidelines"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                Google&apos;s Android brand guidelines
                            </a>
                            .
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-semibold">Twemoji</h2>
                        <p>
                            Anonymous animal avatar SVGs and most dashboard flag SVGs are sourced from{" "}
                            <a
                                href="https://github.com/twitter/twemoji"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                Twitter Twemoji
                            </a>
                            . Twemoji graphics are licensed under the{" "}
                            <a
                                href="https://creativecommons.org/licenses/by/4.0/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                Creative Commons Attribution 4.0 International License
                            </a>
                            .
                        </p>
                        <p>
                            The dashboard Iran flag SVG is sourced from{" "}
                            <a
                                href="https://commons.wikimedia.org/wiki/File:Flag_of_Iran.svg"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                            >
                                Wikimedia Commons File:Flag of Iran.svg
                            </a>
                            , based on the official ISIRI standard and marked public domain by Wikimedia Commons.
                        </p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-base font-semibold">Apple and iOS</h2>
                        <p>
                            Rejourney uses iOS as a referential text label. Apple graphic symbols, logos, and icons
                            are not used as platform icons without express permission from Apple.
                        </p>
                    </section>
                </div>
            </main>
            <Footer />
        </div>
    );
}
