import { spawn } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';

// `ffmpeg-static`/`ffprobe-static` are plain CommonJS packages whose shipped
// `.d.ts` (ffmpeg-static) triggers a known TS NodeNext default-import
// interop bug (the import resolves to the whole module namespace instead of
// the exported path). `createRequire` sidesteps that entirely — these are
// just filesystem paths resolved once at module load.
const require = createRequire(import.meta.url);

/**
 * The one MP4 encode profile for social output, copied VERBATIM from the
 * `## Constraints` section of `plans/Pf39c2-social-pilot-02.md`:
 *
 *   -c:v libx264 -profile:v high -level:v 4.0 -pix_fmt yuv420p
 *   -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30"
 *   -crf 20 -maxrate 10M -bufsize 20M -g 60 -keyint_min 60 -sc_threshold 0 -bf 2
 *   -c:a aac -b:a 128k -ar 48000 -ac 2
 *   -movflags +faststart+negative_cts_offsets -map_metadata -1
 *
 * Do not edit this array ad hoc — if the profile needs to change, change the
 * plan first, then mirror it here. `1080x1920@30` already uses 8,160 of the
 * 8,192 max macroblocks at level 4.0; NEVER raise fps at this resolution.
 */
export const ENCODE_ARGS: readonly string[] = [
	'-c:v',
	'libx264',
	'-profile:v',
	'high',
	'-level:v',
	'4.0',
	'-pix_fmt',
	'yuv420p',
	'-vf',
	'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30',
	'-crf',
	'20',
	'-maxrate',
	'10M',
	'-bufsize',
	'20M',
	'-g',
	'60',
	'-keyint_min',
	'60',
	'-sc_threshold',
	'0',
	'-bf',
	'2',
	'-c:a',
	'aac',
	'-b:a',
	'128k',
	'-ar',
	'48000',
	'-ac',
	'2',
	'-movflags',
	'+faststart+negative_cts_offsets',
	'-map_metadata',
	'-1'
];

/**
 * Named output targets the encode profile is built to hit.
 *
 * social pilot 02a V17 (2026-08-27, user decision): `minDurationSec` (15s)
 * removed. It was a house convention with no recorded rationale anywhere in
 * the repo — not an external platform requirement (Reels/TikTok accept ~3s;
 * Stories' 15s is a per-card MAXIMUM, not a minimum) — and it forced short
 * cards to pad their final motionless payoff frame up to 12.5s past the
 * format's own 3.0s hold. Duration is now a pure function of screen count;
 * only `maxDurationSec` (59s, staying under a minute) remains.
 */
export const TARGET = {
	width: 1080,
	height: 1920,
	fps: 30,
	audioRate: 48000,
	audioChannels: 2,
	maxDurationSec: 59
} as const;

/**
 * Resolves the ffmpeg binary to invoke: the `ffmpeg-static` package binary
 * bundled in `node_modules`, falling back to `ffmpeg` on PATH if the static
 * package failed to resolve for this platform/arch.
 */
function resolveFfmpegBinary(): string {
	const staticPath: string | null = require('ffmpeg-static');
	return typeof staticPath === 'string' && staticPath.length > 0 ? staticPath : 'ffmpeg';
}

/** Same as {@link resolveFfmpegBinary}, but for `ffprobe-static`. */
function resolveFfprobeBinary(): string {
	const staticPath: string | undefined = require('ffprobe-static')?.path;
	return typeof staticPath === 'string' && staticPath.length > 0 ? staticPath : 'ffprobe';
}

/** The resolved ffmpeg/ffprobe binaries, exported so resolution is testable. */
export const FFMPEG_BIN = resolveFfmpegBinary();
export const FFPROBE_BIN = resolveFfprobeBinary();

/** Runs a binary to completion, collecting stdout/stderr, rejecting on non-zero exit. */
function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args);
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`${bin} ${args.join(' ')} exited with code ${code}\n${stderr}`));
			}
		});
	});
}

export interface EncodeInput {
	/** Path to the source video (silent or with a track to discard). */
	videoPath: string;
	/** Path to the audio to mux in. If absent, a silent 48kHz stereo track is synthesized. */
	audioPath?: string;
	outPath: string;
}

export interface EncodeResult {
	outPath: string;
	durationSec: number;
	bytes: number;
}

/**
 * Encodes `input.videoPath` (+ optional `input.audioPath`) to `input.outPath`
 * using {@link ENCODE_ARGS}. Every output MUST carry an audio track — when no
 * `audioPath` is given, a silent 48kHz stereo track is synthesized via
 * `anullsrc` and trimmed to the video's length with `-shortest`.
 */
export async function encode(input: EncodeInput): Promise<EncodeResult> {
	const { videoPath, audioPath, outPath } = input;

	const audioInputArgs = audioPath
		? ['-i', audioPath]
		: ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];

	const args = [
		'-y',
		'-i',
		videoPath,
		...audioInputArgs,
		'-map',
		'0:v:0',
		'-map',
		'1:a:0',
		...ENCODE_ARGS,
		'-shortest',
		outPath
	];

	await run(FFMPEG_BIN, args);

	const [probeResult, fileStat] = await Promise.all([probe(outPath), stat(outPath)]);

	return {
		outPath,
		durationSec: probeResult.durationSec ?? 0,
		bytes: fileStat.size
	};
}

export interface ProbeVideoStream {
	profile: string | null;
	level: number | null;
	pixFmt: string | null;
	width: number | null;
	height: number | null;
	avgFrameRate: number | null;
	rFrameRate: number | null;
	sampleAspectRatio: string | null;
}

export interface ProbeAudioStream {
	codec: string | null;
	sampleRate: number | null;
	channels: number | null;
}

export interface ProbeResult {
	video: ProbeVideoStream | null;
	audio: ProbeAudioStream | null;
	durationSec: number | null;
	/** True only if verified structurally by walking the file's top-level boxes. */
	moovBeforeMdat: boolean;
}

/** Parses an ffprobe rational frame-rate string like "30/1" into a number. */
function parseFrameRateFraction(value: unknown): number | null {
	if (typeof value !== 'string' || value.length === 0) {
		return null;
	}
	const [numerator, denominator] = value.split('/').map(Number);
	if (!Number.isFinite(numerator)) {
		return null;
	}
	if (!denominator) {
		return numerator;
	}
	return numerator / denominator;
}

interface FfprobeStreamJson {
	codec_type?: string;
	codec_name?: string;
	profile?: string;
	level?: number;
	pix_fmt?: string;
	width?: number;
	height?: number;
	avg_frame_rate?: string;
	r_frame_rate?: string;
	sample_rate?: string;
	channels?: number;
	sample_aspect_ratio?: string;
}

interface FfprobeJson {
	streams?: FfprobeStreamJson[];
	format?: { duration?: string };
}

/**
 * Reads the raw box (atom) headers from byte 0 of an MP4/MOV container,
 * without trusting the `+faststart` flag or any decoder's interpretation of
 * it, to determine whether the `moov` box appears before `mdat` at the top
 * level of the file — which is the entire point of `+faststart`.
 */
async function moovPrecedesMdat(filePath: string): Promise<boolean> {
	const handle = await open(filePath, 'r');
	try {
		const { size: fileSize } = await handle.stat();
		const header = Buffer.alloc(16);
		let offset = 0;
		let moovOffset: number | null = null;
		let mdatOffset: number | null = null;

		while (offset < fileSize && (moovOffset === null || mdatOffset === null)) {
			const { bytesRead } = await handle.read(header, 0, 16, offset);
			if (bytesRead < 8) {
				break;
			}

			let boxSize = header.readUInt32BE(0);
			const boxType = header.toString('ascii', 4, 8);
			let headerLength = 8;

			if (boxSize === 1) {
				if (bytesRead < 16) {
					break;
				}
				const high = header.readUInt32BE(8);
				const low = header.readUInt32BE(12);
				boxSize = high * 2 ** 32 + low;
				headerLength = 16;
			} else if (boxSize === 0) {
				boxSize = fileSize - offset;
			}

			if (boxType === 'moov' && moovOffset === null) {
				moovOffset = offset;
			}
			if (boxType === 'mdat' && mdatOffset === null) {
				mdatOffset = offset;
			}

			if (boxSize < headerLength) {
				// Malformed/degenerate box — bail rather than loop forever.
				break;
			}
			offset += boxSize;
		}

		if (moovOffset === null || mdatOffset === null) {
			return false;
		}
		return moovOffset < mdatOffset;
	} finally {
		await handle.close();
	}
}

/**
 * Wraps `ffprobe -show_streams -show_format` and the structural moov/mdat
 * box walk into a single typed summary of a media file's conformance.
 */
export async function probe(filePath: string): Promise<ProbeResult> {
	const [{ stdout }, moovBeforeMdat] = await Promise.all([
		run(FFPROBE_BIN, [
			'-v',
			'error',
			'-print_format',
			'json',
			'-show_streams',
			'-show_format',
			filePath
		]),
		moovPrecedesMdat(filePath)
	]);

	const json: FfprobeJson = JSON.parse(stdout);
	const streams = json.streams ?? [];

	const videoStream = streams.find((s) => s.codec_type === 'video');
	const audioStream = streams.find((s) => s.codec_type === 'audio');

	const video: ProbeVideoStream | null = videoStream
		? {
				profile: videoStream.profile ?? null,
				level: typeof videoStream.level === 'number' ? videoStream.level : null,
				pixFmt: videoStream.pix_fmt ?? null,
				width: typeof videoStream.width === 'number' ? videoStream.width : null,
				height: typeof videoStream.height === 'number' ? videoStream.height : null,
				avgFrameRate: parseFrameRateFraction(videoStream.avg_frame_rate),
				rFrameRate: parseFrameRateFraction(videoStream.r_frame_rate),
				sampleAspectRatio: videoStream.sample_aspect_ratio ?? null
			}
		: null;

	const audio: ProbeAudioStream | null = audioStream
		? {
				codec: audioStream.codec_name ?? null,
				sampleRate: audioStream.sample_rate ? Number(audioStream.sample_rate) : null,
				channels: typeof audioStream.channels === 'number' ? audioStream.channels : null
			}
		: null;

	const durationSec = json.format?.duration ? Number(json.format.duration) : null;

	return { video, audio, durationSec, moovBeforeMdat };
}

const EXPECTED_LEVEL = 40; // ffprobe reports level 4.0 as the integer 40.

/**
 * Throws listing EVERY violation of {@link TARGET} found in `result`, not
 * just the first. This is the gate the publish step relies on before an
 * asset ships.
 */
export function assertMeetsProfile(result: ProbeResult): void {
	const violations: string[] = [];

	if (!result.video) {
		violations.push('no video stream found');
	} else {
		if ((result.video.profile ?? '').toLowerCase() !== 'high') {
			violations.push(`video profile must be High, got ${result.video.profile ?? 'null'}`);
		}
		if (result.video.level !== EXPECTED_LEVEL) {
			violations.push(`video level must be 4.0 (40), got ${result.video.level ?? 'null'}`);
		}
		if (result.video.pixFmt !== 'yuv420p') {
			violations.push(`pix_fmt must be yuv420p, got ${result.video.pixFmt ?? 'null'}`);
		}
		if (result.video.width !== TARGET.width || result.video.height !== TARGET.height) {
			violations.push(
				`dimensions must be ${TARGET.width}x${TARGET.height}, got ${result.video.width ?? 'null'}x${result.video.height ?? 'null'}`
			);
		}
		const fps = result.video.avgFrameRate ?? result.video.rFrameRate;
		if (fps === null || Math.abs(fps - TARGET.fps) > 0.01) {
			violations.push(`fps must be ${TARGET.fps}, got ${fps ?? 'null'}`);
		}
	}

	if (!result.audio) {
		violations.push('no audio stream found');
	} else {
		if (result.audio.codec !== 'aac') {
			violations.push(`audio codec must be aac, got ${result.audio.codec ?? 'null'}`);
		}
		if (result.audio.sampleRate !== TARGET.audioRate) {
			violations.push(`audio sample rate must be ${TARGET.audioRate}, got ${result.audio.sampleRate ?? 'null'}`);
		}
		if (result.audio.channels !== TARGET.audioChannels) {
			violations.push(`audio channels must be ${TARGET.audioChannels}, got ${result.audio.channels ?? 'null'}`);
		}
	}

	if (!result.moovBeforeMdat) {
		violations.push('moov box must precede mdat (missing/ineffective +faststart)');
	}

	// social pilot 02a V17 (2026-08-27): the 15s floor was dropped by user
	// decision (see `TARGET`'s doc comment) — only the 59s ceiling is checked
	// here now.
	if (result.durationSec === null || result.durationSec > TARGET.maxDurationSec) {
		violations.push(`duration must be at most ${TARGET.maxDurationSec}s, got ${result.durationSec ?? 'null'}s`);
	}

	if (violations.length > 0) {
		throw new Error(`Does not meet encode profile:\n- ${violations.join('\n- ')}`);
	}
}
