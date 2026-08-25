import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
	ENCODE_ARGS,
	FFMPEG_BIN,
	FFPROBE_BIN,
	TARGET,
	assertMeetsProfile,
	encode,
	probe,
	type ProbeResult
} from '../encode.js';

const LONG_TIMEOUT = 60_000;

function runFfmpeg(args: string[]): void {
	const result = spawnSync(FFMPEG_BIN, ['-y', ...args], { encoding: 'utf-8' });
	if (result.status !== 0) {
		throw new Error(`ffmpeg failed (${result.status}):\n${result.stderr}`);
	}
}

/** Builds a synthetic silent test-pattern video fixture, entirely offline. */
function buildTestVideo(outPath: string, opts: { width: number; height: number; durationSec: number }): void {
	runFfmpeg([
		'-f',
		'lavfi',
		'-i',
		`testsrc=size=${opts.width}x${opts.height}:rate=30`,
		'-t',
		String(opts.durationSec),
		'-c:v',
		'libx264',
		'-pix_fmt',
		'yuv420p',
		outPath
	]);
}

/** Builds a synthetic sine-wave audio fixture, entirely offline. */
function buildTestAudio(outPath: string, durationSec: number): void {
	runFfmpeg([
		'-f',
		'lavfi',
		'-i',
		`sine=frequency=440:duration=${durationSec}`,
		'-ar',
		'48000',
		'-ac',
		'2',
		outPath
	]);
}

let workDir: string;

beforeAll(async () => {
	workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-encode-'));
});

afterAll(async () => {
	if (workDir) {
		await rm(workDir, { recursive: true, force: true });
	}
});

describe('ENCODE_ARGS', () => {
	// Flag-by-flag so a future edit that silently drops a flag fails here,
	// not in a downstream `ffprobe` assertion that's harder to trace back.
	const expectedFlags: Array<[string, string]> = [
		['-c:v', 'libx264'],
		['-profile:v', 'high'],
		['-level:v', '4.0'],
		['-pix_fmt', 'yuv420p'],
		[
			'-vf',
			'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30'
		],
		['-crf', '20'],
		['-maxrate', '10M'],
		['-bufsize', '20M'],
		['-g', '60'],
		['-keyint_min', '60'],
		['-sc_threshold', '0'],
		['-bf', '2'],
		['-c:a', 'aac'],
		['-b:a', '128k'],
		['-ar', '48000'],
		['-ac', '2'],
		['-movflags', '+faststart+negative_cts_offsets'],
		['-map_metadata', '-1']
	];

	for (const [flag, value] of expectedFlags) {
		it(`includes ${flag} ${value}`, () => {
			const index = ENCODE_ARGS.indexOf(flag);
			expect(index, `expected ${flag} to be present`).toBeGreaterThanOrEqual(0);
			expect(ENCODE_ARGS[index + 1]).toBe(value);
		});
	}

	it('has no stray/unpaired flags beyond the expected set', () => {
		expect(ENCODE_ARGS.length).toBe(expectedFlags.length * 2);
	});
});

describe('binary resolution', () => {
	it('resolves ffmpeg and ffprobe to executables that respond to -version', () => {
		const ffmpegResult = spawnSync(FFMPEG_BIN, ['-version']);
		const ffprobeResult = spawnSync(FFPROBE_BIN, ['-version']);
		expect(ffmpegResult.status).toBe(0);
		expect(ffprobeResult.status).toBe(0);
	});
});

describe('encode + probe conformance (real ffmpeg)', () => {
	it(
		'meets High/L4.0/yuv420p/1080x1920/30fps/AAC-48kHz-stereo, moov before mdat',
		async () => {
			const videoPath = path.join(workDir, 'src-16x9.mp4');
			const audioPath = path.join(workDir, 'src-tone.wav');
			const outPath = path.join(workDir, 'out-conformance.mp4');

			buildTestVideo(videoPath, { width: 1280, height: 720, durationSec: 3 });
			buildTestAudio(audioPath, 3);

			const result = await encode({ videoPath, audioPath, outPath });
			expect(result.outPath).toBe(outPath);
			expect(result.bytes).toBeGreaterThan(0);

			const p = await probe(outPath);

			expect(p.video?.profile?.toLowerCase()).toBe('high');
			expect(p.video?.level).toBe(40);
			expect(p.video?.pixFmt).toBe('yuv420p');
			expect(p.video?.width).toBe(TARGET.width);
			expect(p.video?.height).toBe(TARGET.height);
			const fps = p.video?.avgFrameRate ?? p.video?.rFrameRate ?? null;
			expect(fps).not.toBeNull();
			expect(Math.abs((fps ?? 0) - TARGET.fps)).toBeLessThanOrEqual(0.01);

			expect(p.audio?.codec).toBe('aac');
			expect(p.audio?.sampleRate).toBe(TARGET.audioRate);
			expect(p.audio?.channels).toBe(TARGET.audioChannels);

			expect(p.moovBeforeMdat).toBe(true);
		},
		LONG_TIMEOUT
	);

	it(
		'synthesizes a silent 48kHz stereo track when audioPath is omitted',
		async () => {
			const videoPath = path.join(workDir, 'src-silent.mp4');
			const outPath = path.join(workDir, 'out-silent.mp4');

			buildTestVideo(videoPath, { width: 1080, height: 1920, durationSec: 3 });

			await encode({ videoPath, outPath });
			const p = await probe(outPath);

			expect(p.audio).not.toBeNull();
			expect(p.audio?.codec).toBe('aac');
			expect(p.audio?.sampleRate).toBe(TARGET.audioRate);
			expect(p.audio?.channels).toBe(TARGET.audioChannels);
			expect(p.durationSec).toBeGreaterThan(0);
		},
		LONG_TIMEOUT
	);

	it(
		'letterboxes a non-1080x1920 input to exactly 1080x1920 with SAR 1:1, without stretching',
		async () => {
			const videoPath = path.join(workDir, 'src-4x3.mp4');
			const outPath = path.join(workDir, 'out-letterboxed.mp4');

			// 4:3 is neither 16:9 nor 9:16 — guarantees padding on both axes'
			// worth of aspect mismatch is exercised, not just a clean scale.
			buildTestVideo(videoPath, { width: 640, height: 480, durationSec: 3 });

			await encode({ videoPath, outPath });
			const p = await probe(outPath);

			expect(p.video?.width).toBe(TARGET.width);
			expect(p.video?.height).toBe(TARGET.height);
			expect(p.video?.sampleAspectRatio).toBe('1:1');
		},
		LONG_TIMEOUT
	);
});

describe('assertMeetsProfile', () => {
	it(
		'reports every violation at once for a deliberately non-conforming file',
		async () => {
			const outPath = path.join(workDir, 'non-conforming.mp4');

			// Baseline profile, wrong resolution, wrong fps, no audio track,
			// short duration, no +faststart — none of the profile args applied.
			runFfmpeg([
				'-f',
				'lavfi',
				'-i',
				'testsrc=size=1280x720:rate=24',
				'-t',
				'2',
				'-c:v',
				'libx264',
				'-profile:v',
				'baseline',
				'-pix_fmt',
				'yuv420p',
				'-an',
				outPath
			]);

			const p = await probe(outPath);

			let thrown: Error | null = null;
			try {
				assertMeetsProfile(p);
			} catch (err) {
				thrown = err as Error;
			}

			expect(thrown).not.toBeNull();
			const message = thrown?.message ?? '';
			// More than one problem must be named, not just the first found.
			expect(message).toMatch(/profile/i);
			expect(message).toMatch(/1080x1920/);
			expect(message).toMatch(/audio/i);
			const violationCount = message.split('\n- ').length - 1;
			expect(violationCount).toBeGreaterThan(1);
		},
		LONG_TIMEOUT
	);

	it('does not throw for a synthetic probe result that fully meets the profile', () => {
		const compliant: ProbeResult = {
			video: {
				profile: 'High',
				level: 40,
				pixFmt: 'yuv420p',
				width: TARGET.width,
				height: TARGET.height,
				avgFrameRate: 30,
				rFrameRate: 30,
				sampleAspectRatio: '1:1'
			},
			audio: { codec: 'aac', sampleRate: TARGET.audioRate, channels: TARGET.audioChannels },
			durationSec: 20,
			moovBeforeMdat: true
		};

		expect(() => assertMeetsProfile(compliant)).not.toThrow();
	});

	it(
		'fails a 3-second encode on the 15s duration floor',
		async () => {
			const videoPath = path.join(workDir, 'src-short.mp4');
			const outPath = path.join(workDir, 'out-short.mp4');

			buildTestVideo(videoPath, { width: 1080, height: 1920, durationSec: 3 });

			await encode({ videoPath, outPath });
			const p = await probe(outPath);

			// Everything else about this encode conforms; only duration should fail.
			expect(() => assertMeetsProfile(p)).toThrow(/duration/i);
			expect(() => assertMeetsProfile(p)).toThrow(/15/);
		},
		LONG_TIMEOUT
	);
});
