# Maintainer Documentation

`dev_docs/` contains repository-internal architecture references and operator
runbooks. It is separate from the website-facing product documentation in
`docs/`. Public SDK instructions belong in package READMEs and `docs/`; example
instructions belong beside the example they describe.

## Document contract

Active maintainer documents should:

- describe the current repository behavior, not an unmarked implementation plan;
- identify the code, manifest, or script that is the source of truth;
- include commands only when those commands still exist;
- state whether an operational command is read-only, mutating, or destructive;
- use a `Status` and `Last verified` note when facts can drift with deployment;
- move completed migrations and incident evidence to Git history instead of
  leaving them mixed into active runbooks;
- contain no credentials, customer data, production identifiers, or copied
  production payloads.

When behavior changes, update the narrowest active document in the same pull
request. Do not add a second document for the same workflow.

## Architecture and lifecycle

- [Billing and usage](billing-and-usage.md) — plan gates, usage accounting, and
  replay billing state.
- [Ingest and session recording lifecycle](ingest-session-recording-lifecycle.md)
  — artifact processing, reconciliation, and replay visibility.
- [Replay state columns](replay-state-columns.md) — ownership and meaning of the
  denormalized replay/session fields.
- [Storage and endpoints](storage-and-endpoints.md) — endpoint selection,
  artifact placement, replay reads, and retention deletion.
- [Browser replay architecture](web-support.md) — browser SDK lifecycle,
  privacy boundaries, upload contract, and replay integration.
- [ClickHouse API endpoint analytics](clickhouse-api-endpoint-daily-stats-migration.md)
  — current fact/rollup design and rebuild procedure.
- [Issue detection contract](issue-detection-handoff.md) — internal issue
  detection inputs and API boundary.
- [Production cloud topology](allthingscloud.md) — repository deployment model;
  verify live state before operating on the cluster.

## Runbooks

- [Local issue-detection testing](issue-detection-local-k8s-testing.md)
- [Private admin access](admin-tools-private-access.md)
- [PostgreSQL backup and restore](postgres-backup-and-restore.md)
- [Research-lake catch-up](research-lake-catchup-runbook.md)
- [Google Ads conversion tracking](google-ads-conversion-tracking.md)
- [CI and deployment path](rejourney-ci.md)

Runbooks are not authorization to operate on production. Confirm the target
cluster, namespace, current manifests, recovery point, and rollback plan before
running a mutating command.

## Maintenance backlog

- [Technical debt](technical-debt.md) records known deferred cleanup. Remove an
  item when the underlying code or operational dependency is gone.

## Where other documentation belongs

| Content | Location |
| --- | --- |
| Contributor setup and repository workflow | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Local k3d topology and commands | [`../local-k8s/README.md`](../local-k8s/README.md) |
| Package installation and public API | The package's `README.md` |
| Example-specific setup or SDK switching | The example's `README.md` |
| Public product, SDK, and self-hosting guides | `../docs/` |
| Historical implementation plan or completed migration transcript | Git history |

## Review checklist

Before merging a maintainer-documentation change:

1. Resolve every relative link from the document's own directory.
2. Compare command names with the relevant `package.json` or script path.
3. Compare workload names and topology claims with current manifests.
4. Remove line-number references into source files; link to the file or symbol
   instead.
5. Search for retired subsystem names and production-like identifiers.
6. Make the date and source of any benchmark or operational snapshot explicit.
