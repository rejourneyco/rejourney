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
        <div className="min-h-screen bg-background">
            <Header />
            <div className="container mx-auto px-6 py-16 max-w-4xl">
                {/* Main Content */}
                <div>
                    <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
                    <p className="text-sm text-muted-foreground mb-8">Last Updated: April 13, 2026</p>

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
                                    <li><a href="#rights" className="hover:underline">7. Your Rights (GDPR)</a></li>
                                    <li><a href="#security" className="hover:underline">8. Security</a></li>
                                    <li><a href="#lawful-basis" className="hover:underline">9. Lawful Basis for Processing</a></li>
                                </ul>
                            </div>

                            <h3 id="visitors" className="text-base font-semibold mt-6 mb-2">1. Information for Website Visitors</h3>
                            <p>
                                When you visit rejourney.co, we collect standard log data and use first-party cookies to understand how you interact with our site. This may include your IP address, browser type, and pages visited. We use this information to improve our website and marketing efforts.
                            </p>
                            <p className="mt-4">
                                We use Microsoft Clarity to capture how you use and interact with our website through behavioral metrics, heatmaps, and session replay to improve and market our products/services. Microsoft Clarity uses cookies and other tracking technologies. We load Microsoft Clarity only after you provide explicit consent. For more information about how Microsoft collects and uses your data, visit the <a href="https://privacy.microsoft.com/en-US/privacystatement" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Microsoft Privacy Statement</a>.
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
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Microsoft Clarity</td>
                                            <td className="px-4 py-2 border-b border-input">Website Analytics & Session Recording</td>
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
                                <strong>Metadata & Analytics:</strong> Personally identifiable session metadata is retained for the duration of your active subscription. After a session recording is deleted, anonymized aggregate event data (containing no personal identifiers) is retained indefinitely for product analytics purposes.
                            </p>
                            <p>
                                <strong>Backups:</strong> Encrypted backups are retained for up to 90 days for disaster recovery.
                            </p>

                            <h3 id="rights" className="text-base font-semibold mt-6 mb-2">7. Your Rights (GDPR)</h3>
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

                            <h3 id="security" className="text-base font-semibold mt-6 mb-2">8. Security</h3>
                            <p>
                                We use industry-standard security measures, including TLS 1.3 encryption for data in transit and AES-256 for data at rest. We conduct regular security audits to ensure your data remains protected.
                            </p>

                            <h3 id="lawful-basis" className="text-base font-semibold mt-6 mb-2">9. Lawful Basis for Processing</h3>
                            <p>
                                We rely on the following legal bases under GDPR Article 6 for our processing activities:
                            </p>
                            <ul className="list-disc list-inside space-y-2 ml-4 mt-2">
                                <li><strong>Performance of a contract (Art. 6(1)(b)):</strong> Processing customer account data, billing information, and service-related communications necessary to provide the Service.</li>
                                <li><strong>Consent (Art. 6(1)(a)):</strong> Loading Microsoft Clarity analytics and cookies on our website — only after you provide explicit consent via our cookie consent banner.</li>
                                <li><strong>Legitimate interests (Art. 6(1)(f)):</strong> Processing server log data for security, fraud prevention, and site improvement where our interests are not overridden by your rights.</li>
                                <li><strong>Controller's legal basis (end-user data):</strong> Rejourney processes end-user session data as a Data Processor on behalf of our Customers (Data Controllers). The lawful basis for this processing is determined by the Customer and must be established by the Customer before deploying the Rejourney SDK.</li>
                            </ul>

                            <h3 className="text-base font-semibold mt-6 mb-2">10. Updates</h3>
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
