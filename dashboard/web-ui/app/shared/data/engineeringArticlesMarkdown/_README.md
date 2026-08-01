# Guide Markdown Articles

Files in this folder become public Guides when their filename does not start with `_`. Every file must declare `collection: guide`; the parser rejects missing or unsupported collections so general product content cannot accidentally enter Engineering.

Use `_research-template.md` as the starting point for long research posts. Rename the copy to:

```txt
YYYY-MM-DD-your-article-slug.md
```

The frontmatter drives the Guide page, list page, RSS feed, sitemap image entries, Open Graph tags, Twitter cards, and JSON-LD. Keep the SEO fields specific rather than generic.

Files prefixed with `_` are excluded from the Vite glob and are not bundled into the public app.
