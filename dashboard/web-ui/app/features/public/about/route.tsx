import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { SITE_URL } from "~/shared/lib/internationalMarketing";

const FOUNDERS = [
  {
    name: "Mohammad Rashid",
    role: "CEO",
    photo: "/images/founders/mohammad-rashid.jpg",
    photoAlt: "Mohammad Rashid, CEO of Rejourney",
  },
  {
    name: "Fowwaz Moeen",
    role: "CTO",
    photo: "/images/founders/fowwaz-moeen.jpg",
    photoAlt: "Fowwaz Moeen, CTO of Rejourney",
  },
];

const PRINCIPLES = [
  {
    title: "Be your users.",
    body: "Being your user via watching their issues, joy, and rage all help create and build the best version of your product.",
  },
  {
    title: "Performance and Cost.",
    body: "The Rejourney SDK must be highly performant and cost-effective for indie teams and enterprise alike.",
  },
  {
    title: "The tool should stay light.",
    body: "Rejourney is built around fast setup, low bundle impact, and a lightweight dashboard.",
  },
];

export const meta: MetaFunction = () => {
  const canonicalUrl = `${SITE_URL}/about`;

  return [
    { title: "About Rejourney | Rejourney" },
    {
      name: "description",
      content:
        "Learn about Rejourney, created at The University of Texas at Austin by Mohammad Rashid and Fowwaz Moeen after starting as an internal replay tool.",
    },
    { name: "robots", content: "noindex, follow, max-image-preview:large" },
    { property: "og:title", content: "About Rejourney" },
    {
      property: "og:description",
      content:
        "Rejourney began as an internal tool for our own app, then became the replay-first analytics platform we decided to release publicly.",
    },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:image", content: `${SITE_URL}/images/founders/mohammad-rashid.jpg` },
    { property: "og:image:alt", content: "Mohammad Rashid, CEO of Rejourney" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: "About Rejourney" },
    {
      name: "twitter:description",
      content: "Created at The University of Texas at Austin and based in Austin, TX.",
    },
    { name: "twitter:image", content: `${SITE_URL}/images/founders/mohammad-rashid.jpg` },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
  ];
};

export default function AboutPage() {
  const canonicalUrl = `${SITE_URL}/about`;

  return (
    <div className="public-readable-scope min-h-screen bg-white text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "AboutPage",
            "@id": `${canonicalUrl}#webpage`,
            url: canonicalUrl,
            name: "About Rejourney",
            description:
              "Rejourney was created at The University of Texas at Austin and is based in Austin, TX.",
            mainEntity: {
              "@type": "Organization",
              name: "Rejourney",
              foundingLocation: {
                "@type": "Place",
                name: "The University of Texas at Austin",
                address: {
                  "@type": "PostalAddress",
                  addressLocality: "Austin",
                  addressRegion: "TX",
                  addressCountry: "US",
                },
              },
              location: {
                "@type": "Place",
                name: "Austin, TX",
              },
              founder: FOUNDERS.map((founder) => ({
                "@type": "Person",
                name: founder.name,
                jobTitle: founder.role,
                image: `${SITE_URL}${founder.photo}`,
              })),
            },
          }),
        }}
      />
      <Header />
      <main className="w-full pt-16" aria-label="About Rejourney">
        <section className="border-b-2 border-black bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <p className="font-mono text-xs font-black uppercase text-slate-500">
              About Rejourney
            </p>
            <h1 className="mt-5 max-w-5xl text-4xl font-black uppercase leading-none text-slate-950 sm:text-6xl lg:text-7xl">
              We built Rejourney after needing it ourselves.
            </h1>

            <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
              <div className="max-w-3xl space-y-5 text-lg font-semibold leading-8 text-slate-700">
                <p>
                  Rejourney started as an internal replay tool for our own app. We needed a faster
                  way to see what users actually did, what broke around that moment, and which
                  sessions explained the pattern behind a metric.
                </p>
                <p>
                  We turned that workflow into a public product: replay-first analytics for teams
                  that want the product story and the engineering context in one place.
                </p>
              </div>

              <dl className="border-l-2 border-black pl-6 text-sm font-bold uppercase leading-7 text-slate-700">
                <div>
                  <dt className="font-mono text-[11px] text-slate-500">Created at</dt>
                  <dd className="mt-1 text-slate-950">The University of Texas at Austin</dd>
                </div>
                <div className="mt-6">
                  <dt className="font-mono text-[11px] text-slate-500">Based in</dt>
                  <dd className="mt-1 text-slate-950">Austin, TX</dd>
                </div>
                <div className="mt-8 flex flex-wrap gap-5 normal-case">
                  <Link
                    to="/demo"
                    className="font-black text-slate-950 underline decoration-2 underline-offset-4 hover:text-[#0f766e]"
                  >
                    See the demo
                  </Link>
                  <Link
                    to="/engineering"
                    className="font-black text-slate-950 underline decoration-2 underline-offset-4 hover:text-[#0f766e]"
                  >
                    Engineering log
                  </Link>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section className="border-b-2 border-black bg-[#fafafa]">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
              <div>
                <p className="font-mono text-xs font-black uppercase text-slate-500">Founders</p>
                <h2 className="mt-4 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-5xl">
                  :D
                </h2>
              </div>

              <div className="grid gap-10 md:grid-cols-2">
                {FOUNDERS.map((founder) => (
                  <article key={founder.name} className="border-t-2 border-black pt-6">
                    <img
                      src={founder.photo}
                      alt={founder.photoAlt}
                      className="aspect-square w-full max-w-[280px] object-cover"
                    />
                    <p className="mt-5 font-mono text-xs font-black uppercase text-slate-500">
                      {founder.role}
                    </p>
                    <h3 className="mt-2 text-3xl font-black uppercase leading-tight text-slate-950">
                      {founder.name}
                    </h3>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
            <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
              <div>
                <p className="font-mono text-xs font-black uppercase text-slate-500">
                  What we care about
                </p>
                <h2 className="mt-4 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-5xl">
                  3 Rules
                </h2>
              </div>

              <div className="divide-y-2 divide-black border-y-2 border-black">
                {PRINCIPLES.map((principle) => (
                  <div key={principle.title} className="grid gap-3 py-6 md:grid-cols-[0.8fr_1fr]">
                    <h3 className="text-xl font-black uppercase leading-tight text-slate-950">
                      {principle.title}
                    </h3>
                    <p className="text-base font-semibold leading-7 text-slate-700">
                      {principle.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
