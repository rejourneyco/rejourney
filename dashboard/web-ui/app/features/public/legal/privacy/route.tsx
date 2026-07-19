/**
 * Rejourney Dashboard - Privacy Policy Route
 */

import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";

export const meta: Route.MetaFunction = () => [
    { title: "Privacy Policy - Rejourney" },
    {
        name: "description",
        content: "Privacy Policy for Rejourney. Learn how we collect, use, and protect your data.",
    },
    { property: "og:title", content: "Privacy Policy - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/privacy-policy" },
];

export default function PrivacyPolicy() {
    return (
        <div className="public-readable-scope min-h-screen bg-background">
            <Header />
            <div className="container mx-auto px-6 py-16 max-w-4xl">
                {/* Main Content */}
                <div>
                    <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
                    <p className="text-sm text-muted-foreground mb-8">Last Updated: July 16, 2026</p>

                    <div className="bg-muted/30 border border-input rounded-lg p-8 space-y-6">
                        <div className="text-sm leading-relaxed space-y-6">
                            <p>
                                Rejourney ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy describes how we collect, use, and share information when you use our Service.
                            </p>

                            <div className="bg-background/50 border border-input p-4 rounded-md mb-8">
                                <h2 className="text-sm font-bold uppercase mb-2">Policy Overview</h2>
                                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-xs">
                                    <li><a href="#visitors" className="hover:underline">1. Information for Website Visitors</a></li>
                                    <li><a href="#customers" className="hover:underline">2. Information for Customers</a></li>
                                    <li><a href="#endusers" className="hover:underline">3. Information for End-Users</a></li>
                                    <li><a href="#scrubbing" className="hover:underline">4. Data Scrubbing & Minimization</a></li>
                                    <li><a href="#sharing" className="hover:underline">5. Data Sharing & Sub-processors</a></li>
                                    <li><a href="#retention" className="hover:underline">6. Data Retention</a></li>
                                    <li><a href="#research" className="hover:underline">7. Anonymized Studies & Public Reports</a></li>
                                    <li><a href="#rights" className="hover:underline">8. Your Rights (GDPR)</a></li>
                                    <li><a href="#security" className="hover:underline">9. Security</a></li>
                                    <li><a href="#lawful-basis" className="hover:underline">10. Lawful Basis for Processing</a></li>
                                </ul>
                            </div>

                            <h3 id="visitors" className="text-base font-semibold mt-6 mb-2">1. Information for Website Visitors</h3>
                            <p>
                                When you visit rejourney.co, we collect standard log data and use first-party cookies and local storage identifiers to understand how you interact with our site. This may include your IP address, browser type, and pages visited. We use this information to improve our website and marketing efforts.
                            </p>
                            <p className="mt-4">
                                We use the Rejourney web SDK on rejourney.co to capture optional first-party website analytics, performance signals, and session replay so we can improve our website and product experience. We load Rejourney website analytics and replay only after you provide explicit consent through our cookie consent banner. The SDK masks text inputs by default and does not load third-party session replay tooling.
                            </p>
                            <p className="mt-4">
                                We also use the Google tag for Google Ads conversion measurement. Consent Mode v2 keeps advertising storage, analytics storage, advertising user data, and ad personalization denied until you allow cookies. Before consent, Google Ads click or campaign identifiers are not persisted by Rejourney or submitted with signup requests. When a new account completes signup after consent, the conversion may include normalized email data that Google hashes before transmission, a unique transaction ID for deduplication, and consented Google Ads click or campaign identifiers used for attribution.
                            </p>

                            <h3 id="customers" className="text-base font-semibold mt-6 mb-2">2. Information for Customers</h3>
                            <p>
                                If you create a Rejourney account, we collect information necessary to provide the Service, including your name, email address, and billing information. We use this to manage your account, process payments, and send you Service-related notifications.
                            </p>

                            <h3 id="endusers" className="text-base font-semibold mt-6 mb-2">3. Information for End-Users</h3>
                            <p>
                                Rejourney processes data about your mobile application's end-users on your behalf. This data is collected via the Rejourney SDK and may include session replays, device metadata, approximate geolocation (country, region, city derived from IP address), and interaction events. <strong>You (our Customer) are the Data Controller for this data, and Rejourney is the Data Processor.</strong> You are responsible for ensuring your end-users are informed about session recording and that you have a valid legal basis for such processing.
                            </p>

                            <h3 id="scrubbing" className="text-base font-semibold mt-6 mb-2">4. Data Scrubbing & Minimization</h3>
                            <p>
                                Privacy is built into Rejourney by design. Our SDK automatically scrubs:
                            </p>
                            <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                                <li>Password fields and sensitive text inputs.</li>
                                <li>Camera views and credit card entry fields.</li>
                                <li>Personally Identifiable Information (PII) in user IDs (automatically hashed).</li>
                            </ul>
                            <p className="mt-2">
                                <strong>Console logs:</strong> When console log capture is enabled (on by default), the SDK captures up to 1,000 console log entries per session. Console logs may contain PII depending on your application's logging practices. We recommend disabling this feature or sanitizing logs if sensitive data may appear in console output.
                            </p>
                            <p className="mt-2 text-xs font-semibold text-red-600 uppercase">Disclaimer:</p>
                            <p className="text-xs italic bg-muted p-2 border-l-2 border-primary">
                                While Rejourney provides these automatic privacy measures, they are provided as default tools to assist you. You (the developer/customer) are responsible for verifying that your specific implementation does not capture sensitive data and that you have configured masks or redactions as necessary for your unique UI and data flow.
                            </p>

                            <h3 id="sharing" className="text-base font-semibold mt-6 mb-2">5. Data Sharing & Sub-processors</h3>
                            <p>
                                We do not sell your data. We share information with the following sub-processors to provide the Service:
                            </p>
                            <div className="overflow-x-auto my-4">
                                <table className="min-w-full border border-input text-xs">
                                    <thead className="bg-muted/50 text-left">
                                        <tr>
                                            <th className="px-4 py-2 border-b border-input">Provider</th>
                                            <th className="px-4 py-2 border-b border-input">Purpose</th>
                                            <th className="px-4 py-2 border-b border-input">Location</th>
                                            <th className="px-4 py-2 border-b border-input">Transfer Mechanism</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Hetzner Online GmbH</td>
                                            <td className="px-4 py-2 border-b border-input">Cloud Infrastructure & Hosting</td>
                                            <td className="px-4 py-2 border-b border-input">Germany (EU)</td>
                                            <td className="px-4 py-2 border-b border-input">EU — no transfer</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Cloudflare R2</td>
                                            <td className="px-4 py-2 border-b border-input">Session Data Backups</td>
                                            <td className="px-4 py-2 border-b border-input">EU (Guaranteed)</td>
                                            <td className="px-4 py-2 border-b border-input">EU — no transfer</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">OVHcloud US</td>
                                            <td className="px-4 py-2 border-b border-input">Object Storage</td>
                                            <td className="px-4 py-2 border-b border-input">United States</td>
                                            <td className="px-4 py-2 border-b border-input">DPA</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Microsoft Azure OpenAI Service (GPT-5.5 deployment; effective July 30, 2026)</td>
                                            <td className="px-4 py-2 border-b border-input">AI-assisted revenue-leak prediction using data-minimized, pseudonymized diagnostic and analytics signals</td>
                                            <td className="px-4 py-2 border-b border-input">Customer-selected Azure region; EEA Customer Personal Data is processed in an EU/EFTA regional deployment</td>
                                            <td className="px-4 py-2 border-b border-input">EU Data Boundary where configured; otherwise Microsoft DPA and EU SCCs, where applicable</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">ZeptoMail (Zoho)</td>
                                            <td className="px-4 py-2 border-b border-input">Transactional Email Delivery</td>
                                            <td className="px-4 py-2 border-b border-input">United States</td>
                                            <td className="px-4 py-2 border-b border-input">SCCs (Art. 46(2)(c))</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Stripe</td>
                                            <td className="px-4 py-2 border-b border-input">Payment Processing</td>
                                            <td className="px-4 py-2 border-b border-input">United States</td>
                                            <td className="px-4 py-2 border-b border-input">SCCs (Art. 46(2)(c))</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <h3 id="retention" className="text-base font-semibold mt-6 mb-2">6. Data Retention</h3>
                            <p>
                                <strong>Session Replays:</strong> Automatically deleted after 7 days on the free plan, otherwise retained for the duration detailed in your subscription.
                            </p>
                            <p>
                                <strong>Metadata & Analytics:</strong> Personally identifiable session metadata is retained for the duration of your active subscription. After a session recording is deleted, anonymized aggregate event data (containing no personal identifiers) may be retained indefinitely for product analytics, research, benchmarking, and public trend reporting.
                            </p>
                            <p>
                                <strong>Backups:</strong> Encrypted backups are retained for up to 90 days for disaster recovery.
                            </p>

                            <h3 id="research" className="text-base font-semibold mt-6 mb-2">7. Anonymized Studies, Research Sharing & AI Training</h3>
                            <p>
                                We may analyze, process, and compile Customer Data and service telemetry to create fully anonymized, aggregated, or de-identified datasets. We may share these fully anonymous, non-personally identifiable (PII masked) datasets with trusted third-party research institutions or partners for academic and industrial research purposes.
                            </p>
                            <p className="mt-2">
                                Additionally, we may use such fully anonymous, aggregated, and de-identified data for the purposes of training, developing, and improving our artificial intelligence (AI), machine learning models, and automated features.
                            </p>
                            <p className="mt-2">
                                Prior to any sharing or training use, we apply rigorous privacy-preserving techniques to ensure all Personally Identifiable Information (PII) is permanently stripped or masked, and the data is rendered fully anonymous so that individual users, customer organizations, or apps cannot be re-identified under any circumstances. Once data is fully anonymized, it no longer constitutes "personal data" under the GDPR and other applicable global data privacy regulations.
                            </p>
                            <p className="mt-2">
                                Shared research datasets and model training will never include raw session recordings, screenshots, request payloads, unmasked personal data, customer confidential information, or information that could reasonably identify or single out a particular customer, application, or end-user.
                            </p>
                            <p className="mt-2">
                                Under GDPR, pseudonymized data remains personal data when it can be attributed to an individual using additional information. We treat pseudonymized data as personal data unless and until it has been rendered anonymous so that the individual is not or no longer identifiable by means reasonably likely to be used.
                            </p>

                            <h3 id="rights" className="text-base font-semibold mt-6 mb-2">8. Your Rights (GDPR)</h3>
                            <p>
                                If you are located in the European Economic Area, you have the following rights regarding your personal data:
                            </p>
                            <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                                <li><strong>Access (Art. 15):</strong> Request a copy of the personal data we hold about you.</li>
                                <li><strong>Rectification (Art. 16):</strong> Request correction of inaccurate or incomplete data.</li>
                                <li><strong>Erasure (Art. 17):</strong> Request deletion of your personal data ("right to be forgotten").</li>
                                <li><strong>Restriction (Art. 18):</strong> Request that we restrict processing of your data in certain circumstances.</li>
                                <li><strong>Portability (Art. 20):</strong> Receive your data in a structured, machine-readable format and transfer it to another controller.</li>
                                <li><strong>Objection (Art. 21):</strong> Object to processing based on legitimate interests.</li>
                            </ul>
                            <p className="mt-3">
                                To exercise any of these rights, please contact <a href="mailto:contact@rejourney.co" className="text-primary hover:underline">contact@rejourney.co</a>. We will respond within <strong>30 days</strong> of receiving your request.
                            </p>
                            <p className="mt-3">
                                You also have the right to lodge a complaint with the data protection supervisory authority in your country of residence. A full list of EU supervisory authorities is available at <a href="https://www.edpb.europa.eu/about-edpb/about-edpb/members_en" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">edpb.europa.eu</a>.
                            </p>

                            <h3 id="security" className="text-base font-semibold mt-6 mb-2">9. Security</h3>
                            <p>
                                We use industry-standard security measures, including TLS 1.3 encryption for data in transit and AES-256 for data at rest. We conduct regular security audits to ensure your data remains protected.
                            </p>

                            <h3 id="lawful-basis" className="text-base font-semibold mt-6 mb-2">10. Lawful Basis for Processing</h3>
                            <p>
                                We rely on the following legal bases under GDPR Article 6 for our processing activities:
                            </p>
                            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
                                <li><strong>Performance of a contract (Art. 6(1)(b)):</strong> Processing customer account data, billing information, and service-related communications necessary to provide the Service.</li>
                                <li><strong>Consent (Art. 6(1)(a)):</strong> Loading optional Rejourney website analytics, session replay, and related first-party storage on rejourney.co — only after you provide explicit consent via our cookie consent banner.</li>
                                <li><strong>Legitimate interests (Art. 6(1)(f)):</strong> Processing server log data for security, fraud prevention, and site improvement where our interests are not overridden by your rights.</li>
                                <li><strong>Controller's legal basis (end-user data):</strong> Rejourney processes end-user session data as a Data Processor on behalf of our Customers (Data Controllers). The lawful basis for this processing is determined by the Customer and must be established by the Customer before deploying the Rejourney SDK.</li>
                                <li><strong>Anonymous information:</strong> Once information has been rendered anonymous so that it no longer relates to an identified or identifiable person, it is no longer personal data under GDPR. The processing used to create anonymized aggregate datasets follows the applicable legal basis above and, for end-user data, the Customer's instructions under the DPA.</li>
                            </ul>

                            <h3 className="text-base font-semibold mt-6 mb-2">11. Updates</h3>
                            <p>
                                We may update this policy periodically. Material changes will be notified via email or a prominent notice on our website.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            <Footer />
        </div>
    );
}
