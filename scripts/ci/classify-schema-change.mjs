#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import ts from 'typescript';

const ZERO_OBJECT_ID = /^0+$/;

function fail(message) {
    console.error(`[schema-migration-check] ERROR: ${message}`);
    process.exit(2);
}

function git(args) {
    try {
        return execFileSync('git', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        const detail = error.stderr?.trim() || error.message;
        fail(`git ${args.join(' ')} failed: ${detail}`);
    }
}

function gitExitCode(args) {
    const result = spawnSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'pipe'],
    });

    if (result.error) {
        fail(`git ${args.join(' ')} failed: ${result.error.message}`);
    }

    return result.status;
}

function normalizedTypeScript(source) {
    const sourceFile = ts.createSourceFile(
        'schema.ts',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const printer = ts.createPrinter({
        newLine: ts.NewLineKind.LineFeed,
        removeComments: true,
    });

    return printer.printFile(sourceFile);
}

function definitionsMatch(before, after) {
    return normalizedTypeScript(before) === normalizedTypeScript(after);
}

function classifyRange(range, schemaPath) {
    const rawDiff = git(['diff', '--raw', '--no-abbrev', range, '--', schemaPath]).trim();
    if (!rawDiff) {
        return 'unchanged';
    }

    const entries = rawDiff.split('\n');
    if (entries.length !== 1) {
        fail(`expected one raw diff entry for ${schemaPath}, received ${entries.length}`);
    }

    const match = entries[0].match(
        /^:\d{6} \d{6} ([0-9a-f]+) ([0-9a-f]+) [A-Z][0-9]*\t/
    );
    if (!match) {
        fail(`could not parse the raw diff for ${schemaPath}`);
    }

    const [, beforeObjectId, afterObjectId] = match;
    if (ZERO_OBJECT_ID.test(beforeObjectId) || ZERO_OBJECT_ID.test(afterObjectId)) {
        return 'definition';
    }

    const before = git(['cat-file', 'blob', beforeObjectId]);
    const after = git(['cat-file', 'blob', afterObjectId]);
    return definitionsMatch(before, after) ? 'comments-only' : 'definition';
}

function readGitSource(specifier) {
    const result = spawnSync('git', ['show', specifier], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });

    if (result.error) {
        fail(`git show ${specifier} failed: ${result.error.message}`);
    }

    return result.status === 0 ? result.stdout : null;
}

function classifyWorkingTree(schemaPath) {
    const head = readGitSource(`HEAD:${schemaPath}`);
    const stagedDiffStatus = gitExitCode(['diff', '--cached', '--quiet', '--', schemaPath]);
    if (stagedDiffStatus !== 0 && stagedDiffStatus !== 1) {
        fail(`could not compare the staged version of ${schemaPath} with HEAD`);
    }

    if (stagedDiffStatus === 1) {
        const staged = readGitSource(`:${schemaPath}`);
        if (head === null || staged === null || !definitionsMatch(head, staged)) {
            return 'definition';
        }
    }

    if (!existsSync(schemaPath)) {
        return head === null ? 'unchanged' : 'definition';
    }

    const workingTree = readFileSync(schemaPath, 'utf8');
    if (head === null || !definitionsMatch(head, workingTree)) {
        return 'definition';
    }

    return 'comments-only';
}

const [mode, value, maybeSchemaPath] = process.argv.slice(2);
if (mode === '--range' && value && maybeSchemaPath) {
    console.log(classifyRange(value, maybeSchemaPath));
} else if (mode === '--working-tree' && value && !maybeSchemaPath) {
    console.log(classifyWorkingTree(value));
} else {
    fail(
        'usage: classify-schema-change.mjs --range <git-range> <schema-path> | ' +
            '--working-tree <schema-path>'
    );
}
