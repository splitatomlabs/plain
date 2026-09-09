/**
 * Tests for `../follower-snapshot.ts` (Pb4e17-social-native-scheduling T04)
 * — the daily Instagram follower-snapshot hand-entry CLI. See
 * `./hand-entry.test.ts` for the precedent this file's structure and
 * conventions mirror.
 *
 * Coverage, matching this task's brief:
 *   - Same date recorded twice -> one entry, the later value wins
 *     (upsert-not-duplicate).
 *   - Two different dates -> two entries, sorted by date.
 *   - A follower count of `0` is preserved as `0`, never treated as missing.
 *   - Validation rejects a negative count, a fractional count, a malformed
 *     date (`2026-13-45`, `not-a-date`, `2026-9-9`), each with
 *     `HandEntryValidationError` naming the offending field, and a missing
 *     required flag (`--date`/`--followers`), via `parseFollowerSnapshotArgs`
 *     — the exported CLI-arg layer, unit-tested directly rather than only
 *     through a subprocess, mirroring `readout.ts`'s own
 *     `parseBreakoutThreshold` precedent.
 *   - `recordFollowerSnapshot` does not mutate the array passed in.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HandEntryValidationError } from '../hand-entry.js';
import {
	buildFollowerSnapshot,
	parseFollowerSnapshotArgs,
	recordFollowerSnapshot,
	validateFollowerSnapshotInput,
	type FollowerSnapshotInput
} from '../follower-snapshot.js';
import type { InstagramFollowerSnapshot } from '../schema.js';

function validInput(overrides: Partial<FollowerSnapshotInput> = {}): FollowerSnapshotInput {
	return {
		date: '2026-09-01',
		followers: 1234,
		...overrides
	};
}

describe('buildFollowerSnapshot', () => {
	it('produces a plain InstagramFollowerSnapshot shape', () => {
		const snapshot = buildFollowerSnapshot(validInput());
		expect(snapshot).toEqual<InstagramFollowerSnapshot>({
			date: '2026-09-01',
			followerCount: 1234
		});
	});

	it('preserves a follower count of 0 as a real reading, not a missing value', () => {
		const snapshot = buildFollowerSnapshot(validInput({ followers: 0 }));
		expect(snapshot.followerCount).toBe(0);
	});
});

describe('validateFollowerSnapshotInput', () => {
	it('rejects a negative follower count', () => {
		expect(() => validateFollowerSnapshotInput(validInput({ followers: -1 }))).toThrow(HandEntryValidationError);
		expect(() => validateFollowerSnapshotInput(validInput({ followers: -1 }))).toThrow(/followers/);
	});

	it('rejects a fractional follower count', () => {
		expect(() => validateFollowerSnapshotInput(validInput({ followers: 12.5 }))).toThrow(HandEntryValidationError);
		expect(() => validateFollowerSnapshotInput(validInput({ followers: 12.5 }))).toThrow(/followers/);
	});

	it.each(['2026-13-45', 'not-a-date', '2026-9-9'])('rejects a malformed date %s', (date) => {
		expect(() => validateFollowerSnapshotInput(validInput({ date }))).toThrow(HandEntryValidationError);
		expect(() => validateFollowerSnapshotInput(validInput({ date }))).toThrow(/date/);
	});

	it('accepts a valid date and non-negative integer follower count', () => {
		expect(() => validateFollowerSnapshotInput(validInput())).not.toThrow();
	});
});

describe('recordFollowerSnapshot — upsert-not-duplicate keyed on date', () => {
	it('recording the same date twice keeps one entry, with the later value winning', () => {
		const first = recordFollowerSnapshot([], validInput({ date: '2026-09-01', followers: 1000 }));
		const second = recordFollowerSnapshot(first, validInput({ date: '2026-09-01', followers: 1050 }));

		expect(second).toHaveLength(1);
		expect(second[0]).toEqual<InstagramFollowerSnapshot>({ date: '2026-09-01', followerCount: 1050 });
	});

	it('two different dates produce two entries, sorted by date', () => {
		const first = recordFollowerSnapshot([], validInput({ date: '2026-09-02', followers: 1100 }));
		const second = recordFollowerSnapshot(first, validInput({ date: '2026-09-01', followers: 1000 }));

		expect(second).toHaveLength(2);
		expect(second.map((s) => s.date)).toEqual(['2026-09-01', '2026-09-02']);
	});

	it('does not mutate the existing array passed in', () => {
		const existing = recordFollowerSnapshot([], validInput({ date: '2026-09-01', followers: 1000 }));
		const existingCopy = [...existing];
		recordFollowerSnapshot(existing, validInput({ date: '2026-09-02', followers: 1100 }));
		expect(existing).toEqual(existingCopy);
	});

	it('throws before upserting when the input is invalid', () => {
		expect(() => recordFollowerSnapshot([], validInput({ followers: -5 }))).toThrow(HandEntryValidationError);
	});
});

describe('parseFollowerSnapshotArgs — CLI-level required-flag validation', () => {
	it('throws when --date is missing', () => {
		expect(() => parseFollowerSnapshotArgs({ followers: '100' })).toThrow(/--date/);
	});

	it('throws when --followers is missing', () => {
		expect(() => parseFollowerSnapshotArgs({ date: '2026-09-01' })).toThrow(/--followers/);
	});

	it('throws when --followers is not a number', () => {
		expect(() => parseFollowerSnapshotArgs({ date: '2026-09-01', followers: 'not-a-number' })).toThrow(/--followers/);
	});

	it('parses valid raw args into a FollowerSnapshotInput', () => {
		expect(parseFollowerSnapshotArgs({ date: '2026-09-01', followers: '0' })).toEqual<FollowerSnapshotInput>({
			date: '2026-09-01',
			followers: 0
		});
	});

	it('D2 — an empty --followers value throws rather than fabricating 0', () => {
		expect(() => parseFollowerSnapshotArgs({ date: '2026-09-01', followers: '' })).toThrow(/--followers/);
	});
});

// ---------------------------------------------------------------------------
// The real CLI process — `main()` (Pb4e17-social-native-scheduling F1). None
// of the tests above ever import/exercise `main()`; they only call the pure
// exports directly. Mirrors `hand-entry.test.ts`'s own CLI subprocess block
// and `prepare-week.test.ts`'s `--help` convention (see its header comment).
// ---------------------------------------------------------------------------

describe('CLI — main()', () => {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
	const cliPath = path.join(repoRoot, 'social', 'src', 'metrics', 'follower-snapshot.ts');

	let outDir: string;

	beforeEach(async () => {
		outDir = await mkdtemp(path.join(tmpdir(), 'plain-follower-snapshot-'));
	});

	afterEach(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
		try {
			const stdout = execFileSync('npx', ['tsx', cliPath, ...args], {
				cwd: repoRoot,
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
			return { status: 0, stdout, stderr: '' };
		} catch (e) {
			const err = e as { status: number | null; stdout: string; stderr: string };
			return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
		}
	}

	it('records a followerCount of 0 as a real reading, and re-running for the same date leaves exactly one entry', async () => {
		const args = ['--date', '2026-09-09', '--followers', '0', '--out-dir', outDir];

		const first = runCli(args);
		expect(first.status).toBe(0);

		const filePath = path.join(outDir, 'instagram-followers.json');
		const rowsAfterFirst = JSON.parse(await readFile(filePath, 'utf-8'));
		expect(rowsAfterFirst).toEqual([{ date: '2026-09-09', followerCount: 0 }]);

		const second = runCli(args);
		expect(second.status).toBe(0);

		const rowsAfterSecond = JSON.parse(await readFile(filePath, 'utf-8'));
		expect(rowsAfterSecond).toEqual([{ date: '2026-09-09', followerCount: 0 }]);
	});

	it('D2 — an empty --followers exits non-zero and writes nothing', async () => {
		const result = runCli(['--date', '2026-09-09', '--followers', '', '--out-dir', outDir]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/--followers/);
		expect(await readdir(outDir)).toHaveLength(0);
	});

	it('F4 — an empty --out-dir exits non-zero, names the flag, and writes nothing (never silently falls through to the default)', async () => {
		const result = runCli(['--date', '2026-09-09', '--followers', '0', '--out-dir', '']);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/--out-dir/);
		expect(await readdir(outDir)).toHaveLength(0);
	});
});
