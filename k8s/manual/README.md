# Manual-only migration manifests

These manifests are intentionally excluded from the normal CI deploy path by
`scripts/k8s/deploy-release.sh`.

Use them only during the manual storage cutover window after the Phase 1 deploy
is green on `main`.
