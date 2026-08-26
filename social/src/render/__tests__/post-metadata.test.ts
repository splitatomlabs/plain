import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { postMetadataPathFor, writePostMetadata, type PostMetadata } from '../post-metadata.js';

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'plain-post-metadata-'));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('postMetadataPathFor', () => {
	it('swaps only the extension, keeping the asset beside its sidecar', () => {
		expect(postMetadataPathFor('/out/wall-2026-09-01-slot1.mp4')).toBe('/out/wall-2026-09-01-slot1.json');
	});

	it('handles paths with no directory component', () => {
		expect(postMetadataPathFor('wall-2026-09-01-slot1.mp4')).toBe('wall-2026-09-01-slot1.json');
	});

	it('handles multiple dots by only touching the final extension', () => {
		expect(postMetadataPathFor('/out/wall.2026-09-01.slot1.mp4')).toBe('/out/wall.2026-09-01.slot1.json');
	});
});

describe('writePostMetadata', () => {
	it('round-trips a Wall record as JSON', async () => {
		const outPath = path.join(dir, 'wall-2026-09-01-slot1.json');
		const metadata: PostMetadata = {
			card_id: 'meditations-07-031',
			format: 'wall',
			rendered_at: '2026-09-01T00:00:00.000Z'
		};

		await writePostMetadata(outPath, metadata);

		const raw = await readFile(outPath, 'utf-8');
		const parsed = JSON.parse(raw) as PostMetadata;
		expect(parsed).toEqual(metadata);
	});

	it('round-trips a non-Wall record', async () => {
		const outPath = path.join(dir, 'question-2026-09-01-slot2.json');
		const metadata: PostMetadata = {
			card_id: 'discourses-17-002',
			format: 'question',
			rendered_at: '2026-09-01T00:00:00.000Z'
		};

		await writePostMetadata(outPath, metadata);

		const raw = await readFile(outPath, 'utf-8');
		const parsed = JSON.parse(raw) as PostMetadata;
		expect(parsed).toEqual(metadata);
	});

	it('never uses Date.now() — rendered_at is whatever the caller supplied, verbatim', async () => {
		const outPath = path.join(dir, 'wall-fixed-timestamp.json');
		const fixedTimestamp = '2020-01-01T00:00:00.000Z';
		await writePostMetadata(outPath, {
			card_id: 'meditations-07-031',
			format: 'wall',
			rendered_at: fixedTimestamp
		});

		const raw = await readFile(outPath, 'utf-8');
		const parsed = JSON.parse(raw) as PostMetadata;
		expect(parsed.rendered_at).toBe(fixedTimestamp);
		// A real "now" would never equal a 2020 timestamp — this is really a
		// documentation assertion (the value is caller-controlled, not
		// clock-controlled) rather than a meaningful runtime check, but it
		// keeps the intent explicit.
		expect(parsed.rendered_at).not.toBe(new Date().toISOString());
	});

	it("source guard — post-metadata.ts never calls Date.now()", async () => {
		const moduleDir = path.dirname(new URL(import.meta.url).pathname);
		const source = await readFile(path.join(moduleDir, '..', 'post-metadata.ts'), 'utf-8');
		expect(source).not.toMatch(/Date\.now\(\)/);
		expect(source).not.toMatch(/new Date\(\)/);
	});
});
