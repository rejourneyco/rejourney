/**
 * Rejourney Dashboard - Privacy Policy Route
 */

import type { Route } from "./+types/privacy-policy";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";

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
                    <p className="text-sm text-muted-foreground mb-8">Last Updated: {new Date().toLocaleDateString()}</p>

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
                                </ul>
                            </div>

                            <h3 id="visitors" className="text-base font-semibold mt-6 mb-2">1. Information for Website Visitors</h3>
                            <p>
                                When you visit rejourney.co, we collect standard log data and use first-party cookies to understand how you interact with our site. This may include your IP address, browser type, and pages visited. We use this information to improve our website and marketing efforts.
                            </p>

                            <h3 id="customers" className="text-base font-semibold mt-6 mb-2">2. Information for Customers</h3>
                            <p>
                                If you create a Rejourney account, we collect information necessary to provide the Service, including your name, email address, and billing information. We use this to manage your account, process payments, and send you Service-related notifications.
                            </p>

                            <h3 id="endusers" className="text-base font-semibold mt-6 mb-2">3. Information for End-Users</h3>
                            <p>
                                Rejourney processes data about your mobile application's end-users on your behalf. This data is collected via the Rejourney SDK and may include session replays, device metadata, and interaction events. <strong>You (our Customer) are the Data Controller for this data, and Rejourney is the Data Processor.</strong>
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
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Hetzner Online GmbH</td>
                                            <td className="px-4 py-2 border-b border-input">Cloud Infrastructure & Hosting</td>
                                            <td className="px-4 py-2 border-b border-input">Germany (EU)</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Cloudflare R2</td>
                                            <td className="px-4 py-2 border-b border-input">Backups</td>
                                            <td className="px-4 py-2 border-b border-input">Global (EU Preference)</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">ZeptoMail (Zoho)</td>
                                            <td className="px-4 py-2 border-b border-input">Transactional Email Delivery</td>
                                            <td className="px-4 py-2 border-b border-input">United States</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Stripe</td>
                                            <td className="px-4 py-2 border-b border-input">Payment Processing</td>
                                            <td className="px-4 py-2 border-b border-input">United States</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Microsoft Clarity</td>
                                            <td className="px-4 py-2 border-b border-input">Website Analytics & Session Recording</td>
                                            <td className="px-4 py-2 border-b border-input">United States (Global)</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <h3 id="retention" className="text-base font-semibold mt-6 mb-2">6. Data Retention</h3>
                            <p>
                                <strong>Session Replays:</strong> Automatically deleted after 7 days.
                            </p>
                            <p>
                                <strong>Metadata & Analytics:</strong> Retained for the duration of your subscription to provide historical insights.
                            </p>
                            <p>
                                <strong>Backups:</strong> Encrypted backups are retained for up to 90 days for disaster recovery.
                            </p>

                            <h3 id="rights" className="text-base font-semibold mt-6 mb-2">7. Your Rights (GDPR)</h3>
                            <p>
                                Depending on your location, you may have the right to access, correct, or delete your personal data.
                            </p>
                            <p className="mt-2 text-primary">
                                To exercise these rights, please contact <a href="mailto:contact@rejourney.co" className="hover:underline">contact@rejourney.co</a>.
                            </p>

                            <h3 id="security" className="text-base font-semibold mt-6 mb-2">8. Security</h3>
                            <p>
                                We use industry-standard security measures, including TLS 1.3 encryption for data in transit and AES-256 for data at rest. We conduct regular security audits to ensure your data remains protected.
                            </p>

                            <h3 className="text-base font-semibold mt-6 mb-2">9. Updates</h3>
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
