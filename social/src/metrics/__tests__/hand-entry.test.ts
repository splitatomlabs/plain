/**
 * Tests for `../hand-entry.ts` (Pb4e17-social-native-scheduling T02) — the
 * platform-agnostic generalisation of the now-deleted `tiktok-manual.ts`'s
 * hand-entry fallback, now covering all three native-scheduled platforms
 * (`instagram` / `youtube` / `tiktok`) with `platform` and `follows`
 * promoted from hardcoded values to parameters. `../tiktok-manual.ts` and
 * `./tiktok-manual.test.ts` (this file's precedent for structure and
 * conventions) were both deleted once `hand-entry.ts` superseded them.
 *
 * Coverage, matching this task's brief:
 *   - A row built for each of `instagram` / `youtube` / `tiktok`, asserting
 *     `row.platform` and `<platform>:<postId>` identity (mirrors
 *     `schema.ts`'s `metricsRowKey`).
 *   - `follows` accepted as an integer AND as `null` (never coerced to `0`).
 *   - `averagePercentWatched` optional and `null` when absent (never
 *     coerced to `0`).
 *   - Validation rejects a negative or non-integer count for each of the
 *     four counts (`views`/`likes`/`comments`/`shares`), plus negative/
 *     fractional `follows`, out-of-range `averagePercentWatched`, an
 *     empty/missing `postId`, and an unparseable `publishedAt`/`collectedAt`
 *     — each with `HandEntryValidationError` naming the offending field.
 *   - `recordHandEntry` upserts via `schema.ts`'s `upsertMetricsRow`:
 *     re-recording the same `platform:postId` replaces (length unchanged,
 *     new values present); the same `postId` under a different platform is
 *     a distinct row (length grows).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	HandEntryValidationError,
	assertSingleDailyPost,
	buildHandEnteredMetricsRow,
	recordHandEntry,
	toDir,
	toNumber,
	validateHandEnteredMetrics,
	type HandEnteredMetrics
} from '../hand-entry.js';
import { metricsRowKey, type MetricsPlatform, type MetricsRow } from '../schema.js';

function validInput(overrides: Partial<HandEnteredMetrics> = {}): HandEnteredMetrics {
	return {
		platform: 'tiktok',
		postId: 'post-1',
		publishedAt: '2026-09-01T12:00:00.000Z',
		views: 1000,
		likes: 50,
		comments: 5,
		shares: 3,
		collectedAt: '2026-09-02T00:00:00.000Z',
		...overrides
	};
}

const PLATFORMS: MetricsPlatform[] = ['instagram', 'youtube', 'tiktok'];

describe('buildHandEnteredMetricsRow — a row for each native-scheduled platform', () => {
	it.each(PLATFORMS)('produces a MetricsRow with platform: %s and correct platform:postId identity', (platform) => {
		const row = buildHandEnteredMetricsRow(validInput({ platform, postId: `${platform}-post-1` }));
		expect(row.platform).toBe(platform);
		expect(row.postId).toBe(`${platform}-post-1`);
		expect(metricsRowKey(row)).toBe(`${platform}:${platform}-post-1`);
	});

	it.each(PLATFORMS)('D1 — saves is always null for platform: %s (schema.ts documents this, hand-entry.ts enforces it)', (platform) => {
		const row = buildHandEnteredMetricsRow(validInput({ platform, postId: `${platform}-saves-check` }));
		expect(row.saves).toBeNull();
	});

	it('produces a plain schema.ts MetricsRow shape with format: wall and saves: null', () => {
		const row = buildHandEnteredMetricsRow(validInput());
		expect(row).toEqual<MetricsRow>({
			platform: 'tiktok',
			postId: 'post-1',
			format: 'wall',
			publishedAt: '2026-09-01T12:00:00.000Z',
			views: 1000,
			averagePercentWatched: null,
			likes: 50,
			comments: 5,
			shares: 3,
			saves: null,
			follows: null,
			collectedAt: '2026-09-02T00:00:00.000Z'
		});
	});

	it('passes every count through unchanged', () => {
		const row = buildHandEnteredMetricsRow(validInput({ views: 111, likes: 22, comments: 3, shares: 44 }));
		expect(row.views).toBe(111);
		expect(row.likes).toBe(22);
		expect(row.comments).toBe(3);
		expect(row.shares).toBe(44);
	});

	it('allows a real zero count without collapsing it into null', () => {
		const row = buildHandEnteredMetricsRow(validInput({ views: 0, likes: 0, comments: 0, shares: 0 }));
		expect(row.views).toBe(0);
		expect(row.likes).toBe(0);
		expect(row.comments).toBe(0);
		expect(row.shares).toBe(0);
	});
});

describe('follows — accepted as an integer or null, never fabricated as 0', () => {
	it('passes a positive integer follows through to the row', () => {
		const row = buildHandEnteredMetricsRow(validInput({ platform: 'youtube', follows: 7 }));
		expect(row.follows).toBe(7);
	});

	it('accepts a real zero follows without collapsing it into null', () => {
		const row = buildHandEnteredMetricsRow(validInput({ platform: 'youtube', follows: 0 }));
		expect(row.follows).toBe(0);
		expect(row.follows).not.toBeNull();
	});

	it('sets follows to null when explicitly passed null', () => {
		const row = buildHandEnteredMetricsRow(validInput({ platform: 'instagram', follows: null }));
		expect(row.follows).toBeNull();
	});

	it('sets follows to null when omitted entirely', () => {
		const row = buildHandEnteredMetricsRow(validInput({ platform: 'tiktok' }));
		expect(row.follows).toBeNull();
	});
});

describe('averagePercentWatched — optional, null when absent, never fabricated as 0', () => {
	it('is null when omitted', () => {
		const row = buildHandEnteredMetricsRow(validInput());
		expect(row.averagePercentWatched).toBeNull();
	});

	it('is null when explicitly passed null', () => {
		const row = buildHandEnteredMetricsRow(validInput({ averagePercentWatched: null }));
		expect(row.averagePercentWatched).toBeNull();
	});

	it('accepts a valid percentage within 0-100', () => {
		const row = buildHandEnteredMetricsRow(validInput({ averagePercentWatched: 63.5 }));
		expect(row.averagePercentWatched).toBe(63.5);
	});

	it('accepts the boundary value 0 without collapsing it into null', () => {
		const row = buildHandEnteredMetricsRow(validInput({ averagePercentWatched: 0 }));
		expect(row.averagePercentWatched).toBe(0);
		expect(row.averagePercentWatched).not.toBeNull();
	});

	it('accepts the boundary value 100', () => {
		const row = buildHandEnteredMetricsRow(validInput({ averagePercentWatched: 100 }));
		expect(row.averagePercentWatched).toBe(100);
	});
});

describe('validateHandEnteredMetrics — fails loudly on a typo, naming the offending field', () => {
	it('rejects an unrecognised platform', () => {
		expect(() => validateHandEnteredMetrics(validInput({ platform: 'facebook' as unknown as MetricsPlatform }))).toThrow(
			HandEntryValidationError
		);
	});

	it('names "platform" in the error message for an unrecognised platform', () => {
		expect(() => validateHandEnteredMetrics(validInput({ platform: 'facebook' as unknown as MetricsPlatform }))).toThrow(/platform/);
	});

	it('rejects an empty postId', () => {
		expect(() => validateHandEnteredMetrics(validInput({ postId: '' }))).toThrow(HandEntryValidationError);
	});

	it('rejects a missing postId', () => {
		expect(() => validateHandEnteredMetrics(validInput({ postId: undefined as unknown as string }))).toThrow(
			HandEntryValidationError
		);
	});

	it.each(['views', 'likes', 'comments', 'shares'] as const)('rejects a negative %s', (field) => {
		expect(() => validateHandEnteredMetrics(validInput({ [field]: -1 }))).toThrow(HandEntryValidationError);
	});

	it.each(['views', 'likes', 'comments', 'shares'] as const)('rejects a non-integer %s', (field) => {
		expect(() => validateHandEnteredMetrics(validInput({ [field]: 1.5 }))).toThrow(HandEntryValidationError);
	});

	it.each(['views', 'likes', 'comments', 'shares'] as const)('names the offending field %s in the error message', (field) => {
		expect(() => validateHandEnteredMetrics(validInput({ [field]: -1 }))).toThrow(new RegExp(field));
	});

	it('rejects a NaN count', () => {
		expect(() => validateHandEnteredMetrics(validInput({ views: Number.NaN }))).toThrow(HandEntryValidationError);
	});

	it('rejects a negative follows', () => {
		expect(() => validateHandEnteredMetrics(validInput({ platform: 'youtube', follows: -1 }))).toThrow(
			HandEntryValidationError
		);
	});

	it('rejects a fractional follows', () => {
		expect(() => validateHandEnteredMetrics(validInput({ platform: 'youtube', follows: 2.5 }))).toThrow(
			HandEntryValidationError
		);
	});

	it('does not reject a null follows', () => {
		expect(() => validateHandEnteredMetrics(validInput({ follows: null }))).not.toThrow();
	});

	it.each(['instagram', 'tiktok'] as const)('F1 — rejects a %s row that supplies follows at all', (platform) => {
		expect(() => validateHandEnteredMetrics(validInput({ platform, follows: 5 }))).toThrow(HandEntryValidationError);
		expect(() => validateHandEnteredMetrics(validInput({ platform, follows: 5 }))).toThrow(/follows/);
	});

	it.each(['instagram', 'tiktok'] as const)('F1 — rejects an explicit follows: 0 on %s (a zero is still a fabricated claim)', (platform) => {
		expect(() => validateHandEnteredMetrics(validInput({ platform, follows: 0 }))).toThrow(HandEntryValidationError);
	});

	it('F1 — a null follows on Instagram/TikTok is still fine (omission, not fabrication)', () => {
		expect(() => validateHandEnteredMetrics(validInput({ platform: 'instagram', follows: null }))).not.toThrow();
		expect(() => validateHandEnteredMetrics(validInput({ platform: 'tiktok', follows: null }))).not.toThrow();
	});

	it('rejects an out-of-range averagePercentWatched above 100', () => {
		expect(() => validateHandEnteredMetrics(validInput({ averagePercentWatched: 101 }))).toThrow(HandEntryValidationError);
	});

	it('rejects a negative averagePercentWatched', () => {
		expect(() => validateHandEnteredMetrics(validInput({ averagePercentWatched: -0.1 }))).toThrow(HandEntryValidationError);
	});

	it('rejects a malformed publishedAt', () => {
		expect(() => validateHandEnteredMetrics(validInput({ publishedAt: 'not-a-date' }))).toThrow(HandEntryValidationError);
	});

	it('rejects an empty publishedAt', () => {
		expect(() => validateHandEnteredMetrics(validInput({ publishedAt: '' }))).toThrow(HandEntryValidationError);
	});

	it('rejects a malformed collectedAt', () => {
		expect(() => validateHandEnteredMetrics(validInput({ collectedAt: '2026-13-45' }))).toThrow(HandEntryValidationError);
	});

	it('rejects an empty collectedAt', () => {
		expect(() => validateHandEnteredMetrics(validInput({ collectedAt: '' }))).toThrow(HandEntryValidationError);
	});

	it('F1 — rejects a Date.parse-able but non-ISO collectedAt (e.g. "09/09/2026")', () => {
		// `Date.parse('09/09/2026')` succeeds (US M/D/Y order), so a bare
		// `Number.isNaN(Date.parse(...))` check would accept this — the ISO
		// `T` separator requirement is what actually rejects it. See
		// `isValidIsoInstant`'s own comment for why this class of ambiguous
		// date string must not silently pass.
		expect(() => validateHandEnteredMetrics(validInput({ collectedAt: '09/09/2026' }))).toThrow(HandEntryValidationError);
		expect(() => validateHandEnteredMetrics(validInput({ collectedAt: '09/09/2026' }))).toThrow(/collectedAt/);
	});

	it('accepts a fully valid entry for each platform without throwing', () => {
		for (const platform of PLATFORMS) {
			expect(() => validateHandEnteredMetrics(validInput({ platform }))).not.toThrow();
		}
	});

	it('never reaches buildHandEnteredMetricsRow with a bad row — invalid input throws before any row is built', () => {
		expect(() => buildHandEnteredMetricsRow(validInput({ views: -5 }))).toThrow(HandEntryValidationError);
	});
});

describe('recordHandEntry — upserts via schema.ts\'s upsertMetricsRow, keyed on platform:postId', () => {
	it('re-recording the same platform:postId replaces the row rather than duplicating it', () => {
		const first = recordHandEntry([], validInput({ platform: 'instagram', postId: 'shared-id', views: 100 }));
		const second = recordHandEntry(first, validInput({ platform: 'instagram', postId: 'shared-id', views: 200 }));

		expect(second).toHaveLength(1);
		expect(second[0].views).toBe(200);
	});

	it('the same postId under a different platform is a distinct row, not a replacement', () => {
		const first = recordHandEntry([], validInput({ platform: 'instagram', postId: 'shared-id' }));
		const second = recordHandEntry(first, validInput({ platform: 'youtube', postId: 'shared-id' }));

		expect(second).toHaveLength(2);
		const platforms = second.map((row) => row.platform).sort();
		expect(platforms).toEqual(['instagram', 'youtube']);
	});

	it('adds rows for all three platforms sharing the same postId as three distinct rows', () => {
		let rows: MetricsRow[] = [];
		for (const platform of PLATFORMS) {
			rows = recordHandEntry(rows, validInput({ platform, postId: 'same-post-id' }));
		}

		expect(rows).toHaveLength(3);
		expect(rows.map((row) => metricsRowKey(row)).sort()).toEqual([
			'instagram:same-post-id',
			'tiktok:same-post-id',
			'youtube:same-post-id'
		]);
	});

	it('does not mutate the existing rows array passed in', () => {
		const existing = recordHandEntry([], validInput({ platform: 'tiktok', postId: 'a' }));
		const existingCopy = [...existing];
		recordHandEntry(existing, validInput({ platform: 'youtube', postId: 'b' }));
		expect(existing).toEqual(existingCopy);
	});

	it('two different posts on the same platform both persist as separate rows', () => {
		const afterFirst = recordHandEntry([], validInput({ platform: 'tiktok', postId: 'tiktok-video-1' }));
		const afterSecond = recordHandEntry(afterFirst, validInput({ platform: 'tiktok', postId: 'tiktok-video-2' }));

		expect(afterSecond).toHaveLength(2);
		expect(afterSecond.map((row) => row.postId).sort()).toEqual(['tiktok-video-1', 'tiktok-video-2']);
	});
});

// ---------------------------------------------------------------------------
// `toNumber` — the shared empty/whitespace/NaN guard behind every numeric CLI
// flag on this file AND `follower-snapshot.ts`'s `--followers`. Tested
// directly here (not just through a CLI subprocess) so a future refactor
// that weakens the guard's OWN body fails immediately, independent of
// whichever caller happens to be exercised elsewhere.
// ---------------------------------------------------------------------------

describe('toNumber', () => {
	it('throws on an empty string, naming the flag', () => {
		expect(() => toNumber('', '--views')).toThrow(/--views/);
	});

	it('throws on a whitespace-only string', () => {
		expect(() => toNumber('   ', '--views')).toThrow(/--views/);
	});

	it('accepts a numeric string with incidental surrounding whitespace', () => {
		expect(toNumber(' 10 ', '--views')).toBe(10);
	});

	it('throws on a non-numeric string, naming the flag', () => {
		expect(() => toNumber('abc', '--views')).toThrow(/--views/);
	});
});

// ---------------------------------------------------------------------------
// `toDir` — F4 (Pb4e17-social-native-scheduling review round 4), the
// string-flag remainder of the class `toNumber` above closed for numerics.
// Shared with `follower-snapshot.ts`'s `--out-dir` and `readout.ts`'s
// `--metrics-dir` — tested directly here so a future weakening of the
// guard's own body fails immediately, independent of whichever caller is
// exercised elsewhere.
// ---------------------------------------------------------------------------

describe('toDir', () => {
	it('returns the fallback when raw is undefined (flag genuinely omitted)', () => {
		expect(toDir(undefined, '--out-dir', '/default/dir')).toBe('/default/dir');
	});

	it('throws on an empty string, naming the flag, rather than falling through to the fallback', () => {
		expect(() => toDir('', '--out-dir', '/default/dir')).toThrow(/--out-dir/);
	});

	it('throws on a whitespace-only string', () => {
		expect(() => toDir('   ', '--out-dir', '/default/dir')).toThrow(/--out-dir/);
	});

	it('returns a genuinely supplied path unchanged, not the fallback', () => {
		expect(toDir('/custom/dir', '--out-dir', '/default/dir')).toBe('/custom/dir');
	});
});

// ---------------------------------------------------------------------------
// The real CLI process — `main()` (Pb4e17-social-native-scheduling F1). None
// of the tests above ever import/exercise `main()`; they only call the pure
// exports directly. This is where D1 (a `Date.parse`-able but non-ISO
// `--published-at` silently misfiling the row) and D2 (an empty numeric flag
// fabricating a `0`) actually lived — a real subprocess run against a real
// temp directory, mirroring `prepare-week.test.ts`'s own `--help` subprocess
// convention (see its header comment).
// ---------------------------------------------------------------------------

describe('CLI — main()', () => {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
	const cliPath = path.join(repoRoot, 'social', 'src', 'metrics', 'hand-entry.ts');

	let outDir: string;

	beforeEach(async () => {
		outDir = await mkdtemp(path.join(tmpdir(), 'plain-hand-entry-'));
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

	const VALID_ARGS = [
		'--platform', 'tiktok',
		'--post-id', 't1',
		'--published-at', '2026-09-09T12:00:00.000Z',
		'--views', '10',
		'--likes', '1',
		'--comments', '0',
		'--shares', '0'
	];

	it('writes metrics-<published-date>.json, with follows: null when --follows is omitted', async () => {
		const result = runCli([...VALID_ARGS, '--out-dir', outDir]);
		expect(result.status).toBe(0);

		const filePath = path.join(outDir, 'metrics-2026-09-09.json');
		const rows = JSON.parse(await readFile(filePath, 'utf-8'));
		expect(rows).toHaveLength(1);
		expect(rows[0].postId).toBe('t1');
		expect(rows[0].follows).toBeNull();
	});

	it('D1 — a Date.parse-able but non-ISO --published-at exits non-zero and writes nothing', async () => {
		const result = runCli([
			'--platform', 'youtube',
			'--post-id', 'abc',
			'--published-at', '09/09/2026',
			'--views', '10',
			'--likes', '1',
			'--comments', '0',
			'--shares', '0',
			'--out-dir', outDir
		]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/publishedAt/);
		expect(await readdir(outDir)).toHaveLength(0);
	});

	it('D2 — an empty --follows exits non-zero and writes nothing', async () => {
		const result = runCli([...VALID_ARGS, '--follows', '', '--out-dir', outDir]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/--follows/);
		expect(await readdir(outDir)).toHaveLength(0);
	});

	it('F4 — an empty --out-dir exits non-zero, names the flag, and writes nothing (never silently falls through to the default)', async () => {
		const result = runCli([...VALID_ARGS, '--out-dir', '']);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/--out-dir/);
		// The fixture outDir this test would otherwise write into (had
		// --out-dir NOT been overridden to empty) must stay untouched too.
		expect(await readdir(outDir)).toHaveLength(0);
	});

	it('F1 — --platform instagram --follows 5 exits non-zero, names "follows", and writes nothing', async () => {
		const result = runCli([
			'--platform', 'instagram',
			'--post-id', 'ig1',
			'--published-at', '2026-09-09T12:00:00.000Z',
			'--views', '10',
			'--likes', '1',
			'--comments', '0',
			'--shares', '0',
			'--follows', '5',
			'--out-dir', outDir
		]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/follows/);
		expect(await readdir(outDir)).toHaveLength(0);
	});

	it('F1 — --platform instagram --follows 0 (an explicit zero) is also rejected, and writes nothing', async () => {
		const result = runCli([
			'--platform', 'instagram',
			'--post-id', 'ig2',
			'--published-at', '2026-09-09T12:00:00.000Z',
			'--views', '10',
			'--likes', '1',
			'--comments', '0',
			'--shares', '0',
			'--follows', '0',
			'--out-dir', outDir
		]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/follows/);
		expect(await readdir(outDir)).toHaveLength(0);
	});

	// F2 — `toNumber`'s empty-value guard is reached through TWO different
	// call sites: `parseRequiredNumber` (views/likes/comments/shares) and a
	// direct `toNumber` call (follows/avg-percent-watched). D2 above only
	// ever exercised `--follows`, so a regression that replaced
	// `parseRequiredNumber`'s body with a bare `Number(raw)` (restoring
	// `--views= -> 0` for the four required counts) or replaced
	// `--avg-percent-watched`'s `toNumber` call with `Number(...)` would have
	// left the suite green. Parameterised over every numeric flag on this
	// CLI so no single one of them can regress silently.
	const ALL_NUMERIC_FLAGS = ['--views', '--likes', '--comments', '--shares', '--follows', '--avg-percent-watched'] as const;

	function fullyPopulatedArgs(): string[] {
		return [
			'--platform', 'tiktok',
			'--post-id', 'flag-test',
			'--published-at', '2026-09-09T12:00:00.000Z',
			'--views', '10',
			'--likes', '1',
			'--comments', '0',
			'--shares', '0',
			'--follows', '2',
			'--avg-percent-watched', '50'
		];
	}

	it.each(ALL_NUMERIC_FLAGS)('F2 — an empty %s exits non-zero, names the flag in stderr, and writes nothing', async (flag) => {
		const args = fullyPopulatedArgs();
		const flagIndex = args.indexOf(flag);
		args[flagIndex + 1] = '';

		const result = runCli([...args, '--out-dir', outDir]);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(flag);
		expect(await readdir(outDir)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// `assertSingleDailyPost` — the one-post-per-platform-per-day guard.
//
// The hole it closes, concretely: --post-id is the row's whole identity and
// --published-at drives the week bucket and follower alignment, but nothing
// cross-checks them. A typo'd id on a correction re-run therefore does not
// replace the row it meant to fix — it writes a second one, readout.ts
// dedupes by platform:postId and keeps both, and the phantom post's views
// land in the median criterion B is measured on.
// ---------------------------------------------------------------------------

describe('assertSingleDailyPost — refuses a second post-id for one platform-day', () => {
	function rowFor(overrides: Partial<MetricsRow> = {}): MetricsRow {
		return buildHandEnteredMetricsRow(validInput(overrides as Partial<HandEnteredMetrics>));
	}

	it('allows the first post of a platform-day', () => {
		expect(() => assertSingleDailyPost([], rowFor({ postId: 'a' }))).not.toThrow();
	});

	// The correction path must keep working — this is the whole reason
	// re-running hand-entry.ts is safe.
	it('allows re-entering the SAME post-id (a correction), which upserts rather than duplicating', () => {
		const existing = [rowFor({ postId: 'a', views: 100 })];
		expect(() => assertSingleDailyPost(existing, rowFor({ postId: 'a', views: 200 }))).not.toThrow();
	});

	it('rejects a different post-id on the same platform and published date', () => {
		const existing = [rowFor({ platform: 'instagram', postId: 'ABC123' })];
		expect(() => assertSingleDailyPost(existing, rowFor({ platform: 'instagram', postId: 'ABC124' }))).toThrow(
			HandEntryValidationError
		);
	});

	it('names both ids and the date, so the typo is visible without opening the file', () => {
		const existing = [rowFor({ platform: 'instagram', postId: 'ABC123' })];
		expect(() => assertSingleDailyPost(existing, rowFor({ platform: 'instagram', postId: 'ABC124' }))).toThrow(
			/ABC123.*ABC124|ABC124.*ABC123/s
		);
		expect(() => assertSingleDailyPost(existing, rowFor({ platform: 'instagram', postId: 'ABC124' }))).toThrow(/2026-09-01/);
	});

	// Each platform gets its own post that day — that is the normal weekly
	// session, not a conflict.
	it('allows a different platform on the same date', () => {
		const existing = [rowFor({ platform: 'instagram', postId: 'ig-1' })];
		expect(() => assertSingleDailyPost(existing, rowFor({ platform: 'tiktok', postId: 'tt-1' }))).not.toThrow();
	});

	it('allows the same platform on a different published date', () => {
		const existing = [rowFor({ platform: 'tiktok', postId: 'tt-1', publishedAt: '2026-09-01T12:00:00.000Z' })];
		expect(() =>
			assertSingleDailyPost(existing, rowFor({ platform: 'tiktok', postId: 'tt-2', publishedAt: '2026-09-02T12:00:00.000Z' }))
		).not.toThrow();
	});

	// The guard compares CALENDAR DATE, not instant — two posts hours apart
	// on one day is exactly the case it exists to catch.
	it('compares the date, not the exact instant', () => {
		const existing = [rowFor({ platform: 'tiktok', postId: 'tt-1', publishedAt: '2026-09-01T07:30:00.000Z' })];
		expect(() =>
			assertSingleDailyPost(existing, rowFor({ platform: 'tiktok', postId: 'tt-2', publishedAt: '2026-09-01T23:00:00.000Z' }))
		).toThrow(HandEntryValidationError);
	});
});

// ---------------------------------------------------------------------------
// The same-day guard through the real CLI, including its escape hatch.
// Subprocess, matching the `CLI — main()` suite above: the point is that the
// typo'd entry never reaches disk.
// ---------------------------------------------------------------------------

describe('CLI — the same-day guard', () => {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
	const cliPath = path.join(repoRoot, 'social', 'src', 'metrics', 'hand-entry.ts');

	let outDir: string;

	beforeEach(async () => {
		outDir = await mkdtemp(path.join(tmpdir(), 'plain-hand-entry-guard-'));
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

	function entry(postId: string, extra: string[] = []): string[] {
		return [
			'--platform', 'instagram',
			'--post-id', postId,
			'--published-at', '2026-09-14T11:30:00.000Z',
			'--views', '100', '--likes', '1', '--comments', '0', '--shares', '0',
			'--out-dir', outDir,
			...extra
		];
	}

	async function rowsOnDisk(): Promise<MetricsRow[]> {
		const raw = await readFile(path.join(outDir, 'metrics-2026-09-14.json'), 'utf-8');
		return JSON.parse(raw) as MetricsRow[];
	}

	it('rejects a second post-id for the same platform-day, and writes nothing', async () => {
		expect(runCli(entry('ABC123')).status).toBe(0);

		const second = runCli(entry('ABC124'));
		expect(second.status).not.toBe(0);
		expect(second.stderr).toMatch(/already has a post recorded for 2026-09-14/);
		expect(second.stderr).toMatch(/--allow-second-post/);

		// The phantom row never reached disk — the real point of the guard.
		const rows = await rowsOnDisk();
		expect(rows).toHaveLength(1);
		expect(rows[0].postId).toBe('ABC123');
	});

	it('still lets the same post-id be re-entered as a correction', async () => {
		expect(runCli(entry('ABC123')).status).toBe(0);
		const correction = runCli([
			'--platform', 'instagram', '--post-id', 'ABC123',
			'--published-at', '2026-09-14T11:30:00.000Z',
			'--views', '250', '--likes', '9', '--comments', '2', '--shares', '1',
			'--out-dir', outDir
		]);
		expect(correction.status).toBe(0);

		const rows = await rowsOnDisk();
		expect(rows).toHaveLength(1);
		expect(rows[0].views).toBe(250);
	});

	it('records both when --allow-second-post is passed deliberately', async () => {
		expect(runCli(entry('ABC123')).status).toBe(0);
		expect(runCli(entry('ABC124', ['--allow-second-post'])).status).toBe(0);

		const rows = await rowsOnDisk();
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.postId).sort()).toEqual(['ABC123', 'ABC124']);
	});

	it('does not block a different platform on the same day — the normal weekly session', async () => {
		expect(runCli(entry('ABC123')).status).toBe(0);
		const tiktok = runCli([
			'--platform', 'tiktok', '--post-id', 'TT999',
			'--published-at', '2026-09-14T11:30:00.000Z',
			'--views', '50', '--likes', '0', '--comments', '0', '--shares', '0',
			'--out-dir', outDir
		]);
		expect(tiktok.status).toBe(0);
		expect(await rowsOnDisk()).toHaveLength(2);
	});

	it('documents --allow-second-post in --help', () => {
		const result = runCli(['--help']);
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/--allow-second-post/);
	});
});
