/**
 * Rejourney Dashboard - DPA Route
 */

import type { Route } from "./+types/dpa";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";

export const meta: Route.MetaFunction = () => [
    { title: "Data Processing Agreement - Rejourney" },
    {
        name: "description",
        content: "Data Processing Agreement (DPA) for Rejourney. GDPR compliant data processing terms.",
    },
    { property: "og:title", content: "Data Processing Agreement - Rejourney" },
    { property: "og:url", content: "https://rejourney.co/dpa" },
];

export default function DPA() {
    return (
        <div className="min-h-screen bg-background">
            <Header />
            <div className="container mx-auto px-6 py-16 max-w-4xl">
                {/* Main Content */}
                <div>
                    <h1 className="text-4xl font-bold mb-4">Data Processing Agreement</h1>
                    <p className="text-sm text-muted-foreground mb-8">Last Updated: January 2025</p>

                    <div className="bg-muted/30 border border-input rounded-lg p-8 space-y-6">
                        <div className="text-sm leading-relaxed space-y-6">
                            <p>
                                This Data Processing Agreement ("DPA") is between Rejourney ("Processor") and the Customer ("Controller"). It outlines the parties' obligations regarding the processing of Personal Data under the General Data Protection Regulation (GDPR).
                            </p>

                            <h3 className="text-base font-semibold mt-6 mb-2">1. Scope and Purpose</h3>
                            <p>
                                Processor will process Personal Data only as necessary to provide the Service as described in the Terms and as further specified in <strong>Annex I</strong>.
                            </p>

                            <h3 className="text-base font-semibold mt-6 mb-2">2. Technical and Organizational Measures</h3>
                            <p>
                                Processor has implemented and will maintain the technical and organizational measures specified in <strong>Annex II</strong> to protect Personal Data against unauthorized or unlawful processing and accidental loss, destruction, or damage.
                            </p>

                            <h3 className="text-base font-semibold mt-6 mb-2">3. Sub-processors</h3>
                            <p>
                                Controller grants a general authorization for Processor to engage Sub-processors. Current Sub-processors include:
                            </p>
                            <div className="overflow-x-auto my-4">
                                <table className="min-w-full border border-input text-xs">
                                    <thead className="bg-muted/50 text-left">
                                        <tr>
                                            <th className="px-4 py-2 border-b border-input">Sub-processor</th>
                                            <th className="px-4 py-2 border-b border-input">Purpose</th>
                                            <th className="px-4 py-2 border-b border-input">Location</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Hetzner Online GmbH</td>
                                            <td className="px-4 py-2 border-b border-input">Hosting & Infrastructure</td>
                                            <td className="px-4 py-2 border-b border-input">Germany (EU)</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">Cloudflare R2</td>
                                            <td className="px-4 py-2 border-b border-input">Session Data Storage</td>
                                            <td className="px-4 py-2 border-b border-input">Global (EU Preference)</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-2 border-b border-input">ZeptoMail (Zoho)</td>
                                            <td className="px-4 py-2 border-b border-input">Email Notifications</td>
                                            <td className="px-4 py-2 border-b border-input">United States</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <h3 className="text-base font-semibold mt-6 mb-2">4. Data Subject Rights</h3>
                            <p>
                                Processor will assist Controller in fulfilling its obligations to respond to requests from individuals exercising their rights under GDPR. Please contact <a href="mailto:contact@rejourney.co" className="text-primary hover:underline">contact@rejourney.co</a> for assistance.
                            </p>

                            <h3 className="text-base font-semibold mt-6 mb-2">5. Data Breach Notification</h3>
                            <p>
                                Processor will notify Controller without undue delay (and in no case later than 72 hours) after becoming aware of a personal data breach.
                            </p>

                            <hr className="border-input my-8" />

                            <h2 className="text-xl font-bold mb-4">Annex I: Details of Processing</h2>
                            <p><strong>A. List of Parties</strong></p>
                            <p>Data exporter: The Customer (Controller)</p>
                            <p>Data importer: Rejourney (Processor)</p>

                            <p className="mt-4"><strong>B. Description of Transfer</strong></p>
                            <p>Categories of data subjects: End-users of the Controller's mobile applications.</p>
                            <p>Categories of personal data: IP addresses, device identifiers, session recordings, and interaction metadata.</p>
                            <p>Sensitive data: None. <strong>Controller is responsible for ensuring that no sensitive data is transmitted to Processor by utilizing the provided masking and redaction tools.</strong></p>

                            <h2 className="text-xl font-bold mb-4 mt-8">Annex II: Technical and Organizational Measures</h2>
                            <p className="text-xs italic mb-4">Note: The following measures are default tools provided by Rejourney. Final responsibility for the appropriate configuration and use of these tools lies with the Controller.</p>
                            <ul className="list-disc list-inside space-y-2 ml-4">
                                <li><strong>Access Control:</strong> Logical access controlled via multi-factor authentication and role-based permissions.</li>
                                <li><strong>Encryption:</strong> Data encrypted in transit using TLS 1.3 and at rest using AES-256.</li>
                                <li><strong>Pseudonymization:</strong> User identifiers are hashed upon ingest to prevent direct identification.</li>
                                <li><strong>Redaction:</strong> Automatic UI element masking and sensitive data scrubbing at the SDK level.</li>
                                <li><strong>Resilience:</strong> Regular backups and geographically redundant storage for disaster recovery.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
            <Footer />
        </div>
    );
}
