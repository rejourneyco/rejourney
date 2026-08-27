#!/usr/bin/env node
/**
 * One recording core, vendored into each SDK package.
 *
 * The core cannot simply be referenced in place: npm publishes
 * packages/react-native, pub.dev publishes packages/rejourney, and neither
 * archive can reach outside its own package root. So the canonical source
 * lives in packages/core and is copied, byte for byte, into each SDK.
 *
 *   node scripts/sync-sdk-core.mjs           write the vendored copies
 *   node scripts/sync-sdk-core.mjs --check   fail if any copy has drifted (CI)
 *
 * Editing a vendored copy is always a mistake -- --check is what catches it.
 * Genuine platform differences belong in that platform's own files, never in
 * a divergent copy of a shared one. Files listed in `platformOwned` are
 * deliberately NOT shared; see docs for why each one is excluded.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const SURFACES = [
    {
        name: 'swift',
        canonical: 'packages/core/swift',
        ext: '.swift',
        targets: [
            'packages/ios/Sources/Rejourney',
            'packages/react-native/ios',
            'packages/rejourney/ios/rejourney/Sources/rejourney/Core',
        ],
        // Not shared, and why:
        //   VisualCapture  - three genuinely different capture models (native
        //                    view tree, RN view tree, Flutter single surface).
        //                    Merging them is its own change, with device
        //                    verification; it is not drift.
        platformOwned: ['Recording/VisualCapture.swift'],
    },
    {
        name: 'kotlin',
        canonical: 'packages/core/kotlin',
        ext: '.kt',
        targets: [
            'packages/react-native/android/src/main/java/com/rejourney',
            'packages/rejourney/android/src/main/kotlin/com/rejourney',
        ],
        // Not shared, and why:
        //   VisualCapture     - React Native walks a native view tree; Flutter
        //                       captures a single rendering surface. Different
        //                       implementations, not drift.
        //   RejourneySdkInfo  - the version constant, which is per package.
        platformOwned: ['recording/VisualCapture.kt', 'RejourneySdkInfo.kt'],
    },
];

function walk(dir, ext, base = dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full, ext, base));
        else if (entry.endsWith(ext)) out.push(relative(base, full));
    }
    return out;
}

const check = process.argv.includes('--check');
let drifted = 0;
let written = 0;

for (const surface of SURFACES) {
    const canonicalDir = join(REPO, surface.canonical);
    const files = walk(canonicalDir, surface.ext);

    for (const rel of files) {
        if (surface.platformOwned.includes(rel)) continue;
        const source = readFileSync(join(canonicalDir, rel));

        for (const target of surface.targets) {
            const dest = join(REPO, target, rel);
            let current = null;
            try {
                current = readFileSync(dest);
            } catch {
                /* missing counts as drift */
            }

            if (current !== null && current.equals(source)) continue;

            if (check) {
                drifted += 1;
                const why = current === null ? 'missing' : 'differs from canonical';
                console.error(`  ${target}/${rel} -- ${why}`);
            } else {
                mkdirSync(dirname(dest), { recursive: true });
                writeFileSync(dest, source);
                written += 1;
            }
        }
    }
}

if (check) {
    if (drifted > 0) {
        console.error(
            `\n${drifted} vendored core file(s) do not match packages/core.\n` +
                `Edit the canonical file under packages/core, then run:\n` +
                `  node scripts/sync-sdk-core.mjs\n`
        );
        process.exit(1);
    }
    console.log('SDK core is in sync across all packages.');
} else {
    console.log(`Synced SDK core: ${written} file(s) written.`);
}
