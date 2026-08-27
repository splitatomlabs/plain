import { describe, expect, it, vi } from 'vitest';
import type { R2Config } from '../env.js';
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

const CONFIG: R2Config = {
	accountId: 'test-account-id',
	bucketName: 'plain-social-media',
	accessKeyId: 'test-access-key-id',
	secretAccessKey: 'super-secret-value-do-not-log',
	publicBaseUrl: 'https://media.thinkplain.ai',
};

/** A minimal fake `S3Client` — only `send` is ever called by `storage.ts`. */
function fakeClient() {
	return { send: vi.fn().mockResolvedValue({}) };
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
});

describe('uploadObject', () => {
	it('always sets ContentType on the PutObjectCommand input', async () => {
		const client = fakeClient();

		await uploadObject({
			client: client as never,
			config: CONFIG,
			key: 'posts/2026-09-01/a.mp4',
			body: Buffer.from('bytes'),
			contentType: 'video/mp4',
		});

		expect(client.send).toHaveBeenCalledTimes(1);
		const command = client.send.mock.calls[0][0];
		expect(command.input.ContentType).toBe('video/mp4');
		expect(command.input.Bucket).toBe(CONFIG.bucketName);
		expect(command.input.Key).toBe('posts/2026-09-01/a.mp4');
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

	it('throws on a blank contentType and never calls send', async () => {
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

		expect(client.send).not.toHaveBeenCalled();
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
	it('always sets ContentType on the PutObjectCommand input', async () => {
		const client = fakeClient();

		await uploadFile({
			client: client as never,
			config: CONFIG,
			filePath: '/fake/wall-2026-09-01.mp4',
			key: 'posts/2026-09-01/wall-2026-09-01.mp4',
			contentType: 'video/mp4',
		});

		expect(client.send).toHaveBeenCalledTimes(1);
		const command = client.send.mock.calls[0][0];
		expect(command.input.ContentType).toBe('video/mp4');
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

		expect(client.send).not.toHaveBeenCalled();
	});
});
