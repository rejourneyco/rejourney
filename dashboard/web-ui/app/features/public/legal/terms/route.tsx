/**
 * Rejourney Dashboard - Terms of Service Route
 */

import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";

export const meta: Route.MetaFunction = () => [
    { title: "Terms of Service - Rejourney" },
    {
        name: "description",
        content: "Terms of Service for Rejourney mobile session replay and analytics platform.",
    },
    { property: "og:title", content: "Terms of Service - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/terms-of-service" },
];

export default function TermsOfService() {
    return (
        <div className="public-readable-scope min-h-screen bg-background">
            <Header />
            <div className="container mx-auto px-6 py-16 max-w-4xl">
                {/* Main Content */}
                <div>
                    <h1 className="text-4xl font-bold mb-4">Terms of Service</h1>
                    <p className="text-sm text-muted-foreground mb-8">Last Updated: May 17, 2026</p>

                    <div className="bg-muted/30 border border-input rounded-lg p-8 space-y-6">
                        <div className="text-sm leading-relaxed space-y-6">
                            <p>
                                These Terms of Service ("Terms") govern your access to and use of the Rejourney service ("Service"), provided by Rejourney ("we," "us," or "our").
                            </p>
                            <p>
                                By using the Service, you agree to these Terms.
                            </p>

                            <div className="bg-background/60 border border-input p-4 rounded-md">
                                <h2 className="text-sm font-bold uppercase mb-2">Quick Summary</h2>
                                <ul className="list-disc list-inside space-y-1 text-xs">
                                    <li>Use Rejourney only for lawful mobile and web observability.</li>
                                    <li>Protect end-user privacy and configure masking for sensitive data.</li>
                                    <li>Keep your account secure and pay any fees for your selected plan.</li>
                                    <li>The full Terms below control if this summary conflicts with them.</li>
                                </ul>
                            </div>

                            <div className="bg-background/50 border border-input p-4 rounded-md mb-8">
                                <h2 className="text-sm font-bold uppercase mb-2">Table of Contents</h2>
                                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-xs">
                                    <li><a href="#acceptance" className="hover:underline">1. Acceptance of Terms</a></li>
                                    <li><a href="#service" className="hover:underline">2. Use of Service & Restrictions</a></li>
                                    <li><a href="#accounts" className="hover:underline">3. Accounts & Security</a></li>
                                    <li><a href="#billing" className="hover:underline">4. Billing & Payments</a></li>
                                    <li><a href="#data" className="hover:underline">5. Data, Privacy, Research & Compliance</a></li>
                                    <li><a href="#ip" className="hover:underline">6. Intellectual Property</a></li>
                                    <li><a href="#indemnity" className="hover:underline">7. Indemnification</a></li>
                                    <li><a href="#liability" className="hover:underline">8. Limitation of Liability</a></li>
                                    <li><a href="#termination" className="hover:underline">9. Termination</a></li>
                                    <li><a href="#general" className="hover:underline">10. General Provisions</a></li>
                                </ul>
                            </div>

                            <h3 id="acceptance" className="text-base font-semibold mt-6 mb-2">1. Acceptance of Terms</h3>
                            <p>
                                By accessing or using our Service, you agree to these Terms and our Privacy Policy.
                            </p>
                            <p>
                                If you use the Service for an organization, you agree to these Terms for that organization. You also represent that you have authority to bind that organization.
                            </p>
                            <p>
                                In that case, "you" and "your" refer to that organization.
                            </p>

                            <h3 id="service" className="text-base font-semibold mt-6 mb-2">2. Use of Service & Restrictions</h3>
                            <p>
                                Rejourney grants you a limited, non-exclusive, non-transferable, and revocable license to use our Service for its intended purpose of mobile application session replay and analytics.
                            </p>
                            <p className="mt-4 font-semibold italic">Prohibited Uses</p>
                            <p>
                                You may not use the Service, directly or indirectly, for any unlawful, harmful, or abusive purpose.
                            </p>
                            <p>
                                Without limiting that rule, you agree not to use the Service to:
                            </p>
                            <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                                <li>Develop, operate, or support applications, websites, or services that contain or promote pornographic, sexually explicit, or adult content.</li>
                                <li>Facilitate or enable illegal activities, including unlawful content, exploitation, or abuse.</li>
                                <li>Collect, monitor, or replay user sessions in a manner that violates applicable privacy, data protection, or consent laws.</li>
                                <li>Engage in conduct that is deceptive, exploitative, or reasonably likely to cause harm to end users.</li>
                                <li>Transmit "Sensitive Data" (for example, government-issued IDs, health information, credit card numbers, or passwords) without using Rejourney's masking or redaction tools.</li>
                                <li>Violate any applicable local, state, national, or international law.</li>
                                <li>Infringe our intellectual property rights or the intellectual property rights of others.</li>
                                <li>Upload or transmit viruses, worms, or other malicious code.</li>
                                <li>Violate the specific open source license detailed in the public source code.</li>
                                <li>Use the Service for unauthorized commercial purposes or for the benefit of any third party.</li>
                            </ul>
                            <p className="mt-4">
                                We may investigate, suspend, or terminate access to the Service if we determine that your use violates this section or is otherwise inconsistent with the intended purpose of the Service.
                            </p>

                            <h3 id="accounts" className="text-base font-semibold mt-6 mb-2">3. Accounts & Security</h3>
                            <p>
                                You must provide accurate and complete information when creating an account.
                            </p>
                            <p>
                                You are responsible for all activity under your account and for keeping your account credentials confidential. You must notify us immediately of any security breach or unauthorized account use.
                            </p>

                            <h3 id="billing" className="text-base font-semibold mt-6 mb-2">4. Billing & Payments</h3>
                            <p>
                                Service fees are based on the plan you select and your actual usage. Fees are non-refundable except as required by law.
                            </p>
                            <p>
                                We may change our fees or billing methods with 30 days' notice. If you continue to use the Service after the change takes effect, you agree to pay the modified fees.
                            </p>

                            <h3 id="data" className="text-base font-semibold mt-6 mb-2">5. Data, Privacy & Compliance</h3>
                            <p>
                                Your use of the Service is governed by our <a href="/privacy-policy" className="text-primary hover:underline">Privacy Policy</a> and, if applicable, our <a href="/dpa" className="text-primary hover:underline">Data Processing Agreement (DPA)</a>.
                            </p>
                            <p className="mt-2 text-red-600 font-bold uppercase text-xs">Developer Responsibility:</p>
                            <p className="text-sm border-l-4 border-red-500 pl-4 py-2 bg-red-50/50">
                                Rejourney provides default automatic privacy measures, such as text masking and PII hashing. <strong>These are provided "as-is" as default security tools.</strong>
                            </p>
                            <p className="text-sm border-l-4 border-red-500 pl-4 py-2 bg-red-50/50">
                                You, as the developer or customer, are responsible for ensuring that sensitive user data is properly masked, redacted, or handled under your own privacy policies and applicable data protection laws. Rejourney is not responsible for accidental collection of sensitive data if the default measures are insufficient for your application.
                            </p>
                            <p className="mt-4">
                                <strong>GDPR Compliance:</strong> Rejourney is committed to GDPR compliance. We process data within the European Union and act as a Data Processor for the session data you collect.
                            </p>
                            <p className="mt-4">
                                <strong>Anonymized and Aggregated Studies, Research Sharing & AI Training:</strong> You grant Rejourney a perpetual, irrevocable, worldwide, royalty-free license to create, use, and share fully anonymized, aggregated, or de-identified datasets derived from Customer Data and service telemetry. You agree that Rejourney may:
                            </p>
                            <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                                <li>Use these anonymized and de-identified datasets for academic and industrial research purposes, and share such datasets with trusted research partners and institutions.</li>
                                <li>Use such anonymized, aggregated, and de-identified datasets to train, develop, and improve our artificial intelligence (AI), machine learning models, algorithms, and automated product features.</li>
                                <li>Study usage patterns, performance, reliability, product trends, and publish articles, reports, benchmarks, or other publications based on these aggregated findings.</li>
                            </ul>
                            <p className="mt-2">
                                We will never share or use raw session recordings, unmasked personal data (PII), customer confidential information, or information that could reasonably identify or single out a specific customer, application, or end-user for research or AI training purposes. All personal identifiers are fully masked, hashed, or permanently stripped prior to any processing under this section.
                            </p>
                            <p className="mt-2 text-muted-foreground italic">
                                Note: Session recordings are retained for 7 days by default, after which they are automatically deleted unless you have a paid subscription.
                            </p>
                            <p className="mt-2 text-muted-foreground italic">
                                Personally identifiable session metadata is retained for the duration of your session retention period. After a session recording is deleted, anonymized aggregate event data that contains no personal identifiers may be retained indefinitely for product analytics, research, benchmarking, and public trend reporting.
                            </p>

                            <h3 id="ip" className="text-base font-semibold mt-6 mb-2">6. Intellectual Property</h3>
                            <p>
                                <strong>Our IP:</strong> The Service, including its software, logos, and designs, is the exclusive property of Rejourney and its licensors.
                            </p>
                            <p className="mt-2">
                                <strong>Your IP:</strong> You retain all rights and ownership of the data you upload or collect through the Service ("Customer Data").
                            </p>
                            <p className="mt-2">
                                You grant us a limited license to process Customer Data to provide, secure, maintain, analyze, and improve the Service. You also grant us a limited license to create and use anonymized or aggregated data as described in these Terms, the Privacy Policy, and the DPA.
                            </p>
                            <p className="mt-2">
                                <strong>Publicity:</strong> Unless you request otherwise in writing, you grant us permission to use your name and logo on our website and in marketing materials to identify you as a Rejourney customer.
                            </p>

                            <h3 id="indemnity" className="text-base font-semibold mt-6 mb-2">7. Indemnification</h3>
                            <p>
                                You agree to indemnify and hold harmless Rejourney and its officers, directors, and employees from claims, liabilities, damages, and expenses, including legal fees.
                            </p>
                            <p>
                                This applies to matters arising out of, or connected with, your access to or use of the Service or your violation of these Terms.
                            </p>

                            <h3 id="liability" className="text-base font-semibold mt-6 mb-2">8. Limitation of Liability</h3>
                            <p>
                                To the maximum extent permitted by law, Rejourney shall not be liable for indirect, incidental, special, consequential, or punitive damages.
                            </p>
                            <p>
                                Rejourney shall also not be liable for loss of profits or revenues, whether incurred directly or indirectly, or for loss of data, use, goodwill, or other intangible losses.
                            </p>

                            <h3 id="termination" className="text-base font-semibold mt-6 mb-2">9. Termination</h3>
                            <p>
                                You may terminate your account at any time. We may suspend or terminate your access to the Service for any reason, including a breach of these Terms, upon notice.
                            </p>
                            <p>
                                Upon termination, your right to use the Service will immediately cease. You will have 30 days to export your metadata before it is permanently deleted.
                            </p>

                            <h3 id="general" className="text-base font-semibold mt-6 mb-2">10. General Provisions</h3>
                            <p>
                                <strong>Governing Law:</strong> These Terms shall be governed by the laws of the State of Texas, United States, without regard to its conflict of law provisions.
                            </p>
                            <p className="mt-2">
                                Nothing in these Terms limits the application of the EU General Data Protection Regulation (GDPR) to the extent it applies to personal data of individuals in the European Economic Area.
                            </p>
                            <p className="mt-2">
                                <strong>Entire Agreement:</strong> These Terms, along with our Privacy Policy and DPA, constitute the entire agreement between you and Rejourney regarding the Service.
                            </p>
                            <p className="mt-2">
                                <strong>Contact:</strong> Questions? Email us at <a href="mailto:contact@rejourney.co" className="text-primary hover:underline">contact@rejourney.co</a>.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            <Footer />
        </div>
    );
}
