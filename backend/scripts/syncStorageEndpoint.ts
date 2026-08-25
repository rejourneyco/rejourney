// =============================================================================
// DEPRECATED — DO NOT RUN IN CI / db-setup.
// =============================================================================
//
// This script previously synced the global storage endpoint row from the K8s
// `s3-secret` on every deploy. In multi-bucket setups (e.g. OVH active +
// Hetzner/Scaleway inactive for legacy reads) it overwrote inactive rows into
// duplicates of the active bucket every CI run, silently rerouting old-session
// reads to the wrong place.
//
// `storage_endpoints` is now treated as operator-managed state. CI never
// mutates it. To change credentials or switch buckets, use:
//
//   scripts/k8s/manage-s3-endpoints.mjs   (interactive; private infra repo)
//
// or run SQL by hand against the cluster.
//
// This file is kept as a tombstone (rather than deleted) so the symbol resolves
// for any old workflow / CronJob / migration image still pinned to a previous
// commit. Running it is now a no-op that exits successfully.

console.warn(
  '[syncStorageEndpoint] DEPRECATED — storage_endpoints is operator-managed; CI must not mutate it. Exiting no-op.',
);
process.exit(0);
