import { describe, expect, it, vi } from 'vitest';
import type { GcsConfig } from '../env.js';
import {
	contentTypeFor,
	postKeyFor,
	publicUrlFor,
	tiktokStagingKeyFor,
	uploadFile,
	uploadObject,
} from '../storage.js';

vi.mock('node:fs/promises', () => ({
	readFile: vi.fn().mockResolvedValue(Buffer.from('fake video bytes')),
}));

const CONFIG: GcsConfig = {
	bucketName: 'plain-social-media',
	publicBaseUrl: 'https://media.thinkplain.ai',
};

/**
 * A minimal fake `@google-cloud/storage` `Storage` client — only
 * `bucket(name).file(key).save(data, options)` is ever called by
 * `storage.ts`. `save`/`file`/`bucket` are all exposed on the returned
 * object so a test can assert on any of them (e.g. that `bucket`/`file` were
 * called with the right names, or on `save`'s call arguments).
 */
function fakeClient() {
	const save = vi.fn().mockResolvedValue(undefined);
	const file = vi.fn().mockReturnValue({ save });
	const bucket = vi.fn().mockReturnValue({ file });
	return { bucket, file, save };
}

describe('contentTypeFor', () => {
	it.each([
		['/a/b/wall-2026-09-01.mp4', 'video/mp4'],
		['/a/b/wall-2026-09-01-feed.jpg', 'image/jpeg'],
		['/a/b/wall-2026-09-01-feed.jpeg', 'image/jpeg'],
		['/a/b/wall-2026-09-01.json', 'application/json'],
		['/a/b/captions.txt', 'text/plain'],
	])('maps %s to %s', (filePath, expected) => {
		expect(contentTypeFor(filePath)).toBe(expected);
	});

	it('is case-insensitive on the extension', () => {
		expect(contentTypeFor('/a/b/CLIP.MP4')).toBe('video/mp4');
	});

	it('throws on an unknown extension rather than falling back to octet-stream', () => {
		expect(() => contentTypeFor('/a/b/wall-2026-09-01.mov')).toThrowError(/\.mov/);
	});
});

describe('postKeyFor / tiktokStagingKeyFor', () => {
	it('is a pure, deterministic function of its inputs', () => {
		const first = postKeyFor('2026-09-01', 'wall-2026-09-01.mp4');
		const second = postKeyFor('2026-09-01', 'wall-2026-09-01.mp4');

		expect(first).toBe(second);
		expect(first).toBe('posts/2026-09-01/wall-2026-09-01.mp4');
	});

	it('date-partitions the TikTok staging key as a sibling of posts/', () => {
		const key = tiktokStagingKeyFor('2026-09-01', 'wall-2026-09-01.mp4');

		expect(key).toBe('tiktok-staging/2026-09-01/wall-2026-09-01.mp4');
	});

	it('produces distinct keys for distinct dates or basenames', () => {
		expect(postKeyFor('2026-09-01', 'a.mp4')).not.toBe(postKeyFor('2026-09-02', 'a.mp4'));
		expect(postKeyFor('2026-09-01', 'a.mp4')).not.toBe(postKeyFor('2026-09-01', 'b.mp4'));
	});
});

describe('publicUrlFor', () => {
	it('joins a base URL without a trailing slash and a plain key', () => {
		expect(publicUrlFor(CONFIG, 'posts/2026-09-01/a.mp4')).toBe(
			'https://media.thinkplain.ai/posts/2026-09-01/a.mp4'
		);
	});

	it('does not double the slash when the base URL has a trailing slash', () => {
		const config = { ...CONFIG, publicBaseUrl: 'https://media.thinkplain.ai/' };

		expect(publicUrlFor(config, 'posts/2026-09-01/a.mp4')).toBe(
			'https://media.thinkplain.ai/posts/2026-09-01/a.mp4'
		);
	});

	it('does not drop the slash when the key has a leading slash', () => {
		expect(publicUrlFor(CONFIG, '/posts/2026-09-01/a.mp4')).toBe(
			'https://media.thinkplain.ai/posts/2026-09-01/a.mp4'
		);
	});

	it('handles both a trailing slash on the base and a leading slash on the key together', () => {
		const config = { ...CONFIG, publicBaseUrl: 'https://media.thinkplain.ai/' };

		expect(publicUrlFor(config, '/posts/2026-09-01/a.mp4')).toBe(
			'https://media.thinkplain.ai/posts/2026-09-01/a.mp4'
		);
	});

	it('defaults to the GCS public object URL when publicBaseUrl is unset', () => {
		const config: GcsConfig = { bucketName: 'plain-social-media' };

		expect(publicUrlFor(config, 'posts/2026-09-01/a.mp4')).toBe(
			'https://storage.googleapis.com/plain-social-media/posts/2026-09-01/a.mp4'
		);
	});
});

describe('uploadObject', () => {
	it('always sets contentType on the save() call', async () => {
		const client = fakeClient();

		await uploadObject({
			client: client as never,
			config: CONFIG,
			key: 'posts/2026-09-01/a.mp4',
			body: Buffer.from('bytes'),
			contentType: 'video/mp4',
		});

		expect(client.bucket).toHaveBeenCalledWith(CONFIG.bucketName);
		expect(client.file).toHaveBeenCalledWith('posts/2026-09-01/a.mp4');
		expect(client.save).toHaveBeenCalledTimes(1);
		const [, options] = client.save.mock.calls[0];
		expect(options.contentType).toBe('video/mp4');
	});

	it('returns the public URL of the uploaded object', async () => {
		const client = fakeClient();

		const url = await uploadObject({
			client: client as never,
			config: CONFIG,
			key: 'posts/2026-09-01/a.mp4',
			body: Buffer.from('bytes'),
			contentType: 'video/mp4',
		});

		expect(url).toBe('https://media.thinkplain.ai/posts/2026-09-01/a.mp4');
	});

	it('throws on a blank contentType and never calls save', async () => {
		const client = fakeClient();

		await expect(
			uploadObject({
				client: client as never,
				config: CONFIG,
				key: 'posts/2026-09-01/a.mp4',
				body: Buffer.from('bytes'),
				contentType: '',
			})
		).rejects.toThrowError(/contentType/);

		expect(client.save).not.toHaveBeenCalled();
	});

	it('throws on a whitespace-only contentType', async () => {
		const client = fakeClient();

		await expect(
			uploadObject({
				client: client as never,
				config: CONFIG,
				key: 'posts/2026-09-01/a.mp4',
				body: Buffer.from('bytes'),
				contentType: '   ',
			})
		).rejects.toThrowError(/contentType/);
	});
});

describe('uploadFile', () => {
	it('always sets contentType on the save() call', async () => {
		const client = fakeClient();

		await uploadFile({
			client: client as never,
			config: CONFIG,
			filePath: '/fake/wall-2026-09-01.mp4',
			key: 'posts/2026-09-01/wall-2026-09-01.mp4',
			contentType: 'video/mp4',
		});

		expect(client.save).toHaveBeenCalledTimes(1);
		const [, options] = client.save.mock.calls[0];
		expect(options.contentType).toBe('video/mp4');
	});

	it('returns the public URL of the uploaded object', async () => {
		const client = fakeClient();

		const url = await uploadFile({
			client: client as never,
			config: CONFIG,
			filePath: '/fake/wall-2026-09-01.mp4',
			key: 'posts/2026-09-01/wall-2026-09-01.mp4',
			contentType: 'video/mp4',
		});

		expect(url).toBe('https://media.thinkplain.ai/posts/2026-09-01/wall-2026-09-01.mp4');
	});

	it('throws on a blank contentType before touching the client', async () => {
		const client = fakeClient();

		await expect(
			uploadFile({
				client: client as never,
				config: CONFIG,
				filePath: '/fake/wall-2026-09-01.mp4',
				key: 'posts/2026-09-01/wall-2026-09-01.mp4',
				contentType: '',
			})
		).rejects.toThrowError(/contentType/);

		expect(client.save).not.toHaveBeenCalled();
	});
});
