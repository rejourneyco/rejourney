import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";

const OPENSSF_AI_GUIDE_URL =
    "https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions.html";

export const meta: Route.MetaFunction = () => [
    { title: "Responsible AI Usage - Rejourney" },
    {
        name: "description",
        content: "How Rejourney uses AI coding assistants with security-focused guidance and CI safeguards.",
    },
    { name: "robots", content: "index, follow" },
    { property: "og:title", content: "Responsible AI Usage - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/ai/responsibleusage" },
    { tagName: "link", rel: "canonical", href: "https://rejourney.co/ai/responsibleusage" },
];

export default function ResponsibleAiUsage() {
    return (
        <div className="public-readable-scope min-h-screen bg-[var(--dashboard-canvas,#f8fafd)] text-[#202124]">
            <Header />
            <main className="container mx-auto max-w-3xl px-6 py-16">
                <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-[#202124]">Responsible AI Usage</h1>
                <div className="rounded-none border border-[#dadce0] bg-white p-8 text-sm leading-relaxed text-[#3c4043] shadow-sm">
                    <p>
                        <a
                            href={OPENSSF_AI_GUIDE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#1a73e8] hover:underline"
                        >
                            OpenSSF Security-Focused Guide for AI Code Assistant Instructions
                        </a>
                        {" "}is our baseline for AI-assisted development.
                    </p>
                    <p className="mt-4">
                        Beyond human review, we rely on CI pipelines to catch mistakes that AI
                        code may introduce. Pull requests run locked dependency installs, TypeScript checks,
                        linting, backend and SDK unit tests, billing-focused regression tests, schema and
                        migration guards, SSR production builds, package build verification, and secret hygiene
                        scans before release work can continue.
                    </p>
                    <p className="mt-4">
                        These CI pipelines protect against common AI failures such as invented or unsafe dependencies,
                        code that typechecks locally but breaks a build artifact, missing database migrations (drizzleORM),
                        accidental secret leaks, broken public routes, unsafe deployment diagnostics, optional
                        peer dependency breakage, and mobile install or packaging regressions. Docker images,
                        SDK publishing, and deploy steps only run after the relevant validation jobs pass.
                    </p>
                </div>
            </main>
            <Footer />
        </div>
    );
}
