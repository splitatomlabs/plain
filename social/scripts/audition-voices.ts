/**
 * T14 audition script — manual, one-off, run by a human.
 *
 * Synthesizes the SAME short, verbatim, fixed plain-English passage per
 * Stoic (see `FIXED_PASSAGES` below — each is the opening sentence of a
 * real card in `content/output/`, recorded so the audition is reproducible)
 * through a caller-supplied list of candidate ElevenLabs voice ids, and
 * writes each result to `social/out/audition/` so a human can listen and
 * pick a winner.
 *
 * This script is the ONLY place ElevenLabs voice ids are exercised before
 * T14 is decided. The daily render path (T18's `social/src/cli.ts`) must
 * NEVER call this script or import it — it only reads the already-fixed
 * ids a human pastes into `social/src/audio/voices.ts` after listening.
 *
 * The API key is read from `process.env.ELEVENLABS_API_KEY` inside `main()`
 * at run time, never at module import time or top-level scope — importing
 * this module (e.g. accidentally, from a test) must never require
 * credentials or make a network call.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... npx tsx social/scripts/audition-voices.ts \
 *     --epictetus voiceIdA,voiceIdB,voiceIdC \
 *     --marcus-aurelius voiceIdD,voiceIdE \
 *     --seneca voiceIdF,voiceIdG
 *
 * At least one --<author> flag is required; any subset of the three
 * authors may be auditioned in a single run. Output files are named
 * `social/out/audition/<author>--<voiceId>.wav`. After listening, paste
 * the winning ElevenLabs id (and pick/record a Polly fallback id
 * separately — Polly ids aren't part of this script since Polly voices
 * don't need auditioning the same way) into `VOICE_REGISTRY` in
 * `social/src/audio/voices.ts`, with a written rationale, following the
 * template in `social/assets/voices/README.md`.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

import { ElevenLabsProvider } from '../src/audio/tts.js';
import type { AuthorSlug } from '../src/render/theme.js';
import type { TtsVoice } from '../src/audio/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where audition output audio is written for a human to listen to. */
export const AUDITION_OUT_DIR = path.resolve(__dirname, '..', 'out', 'audition');

const ALL_AUTHORS: readonly AuthorSlug[] = ['epictetus', 'marcus-aurelius', 'seneca'];

interface FixedPassage {
	/** Card id in `content/output/`, so the audition line is traceable back to source. */
	cardId: string;
	/** Path (relative to repo root) of the file the line was taken from. */
	source: string;
	/** The verbatim opening sentence of that card's `plain_english` field. */
	text: string;
}

/**
 * ONE fixed, short, verbatim plain-English line per Stoic — the same
 * passage is used for every candidate voice for that author, so
 * differences a listener hears are differences in the VOICE, not the
 * text. Each is the opening sentence of `plain_english` on the named
 * card, chosen for being short, self-contained, and representative of
 * that Stoic's voice in the app.
 */
const FIXED_PASSAGES: Record<AuthorSlug, FixedPassage> = {
	epictetus: {
		cardId: 'enchiridion-02-001',
		source: 'content/output/enchiridion/section-02.json',
		text: 'Remember what desire and aversion really mean.'
	},
	'marcus-aurelius': {
		cardId: 'meditations-02-004',
		source: 'content/output/meditations/book-02.json',
		text: 'Why do these outside events distract you so much?'
	},
	seneca: {
		cardId: 'peace-of-mind-14-001',
		source: 'content/output/peace-of-mind/section-14.json',
		text: 'We should develop an easy-going attitude.'
	}
};

interface AuditionResult {
	author: AuthorSlug;
	voiceId: string;
	cardId: string;
	outPath: string;
}

/** Parses `--<author> id1,id2,...` flags into a candidate-ids-per-author map. */
export function parseCandidates(argv: string[]): Partial<Record<AuthorSlug, string[]>> {
	const result: Partial<Record<AuthorSlug, string[]>> = {};
	for (const author of ALL_AUTHORS) {
		const flagIndex = argv.indexOf(`--${author}`);
		if (flagIndex === -1) continue;
		const value = argv[flagIndex + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`--${author} requires a comma-separated list of candidate voice ids`);
		}
		const ids = value
			.split(',')
			.map((id) => id.trim())
			.filter((id) => id.length > 0);
		if (ids.length === 0) {
			throw new Error(`--${author} requires at least one non-empty voice id`);
		}
		result[author] = ids;
	}
	return result;
}

function printResultTable(results: AuditionResult[]): void {
	console.log('\nT14 audition results — listen, then paste the winning id into voices.ts\n');
	console.table(
		results.map((r) => ({
			author: r.author,
			candidateVoiceId: r.voiceId,
			passageCardId: r.cardId,
			outPath: r.outPath
		}))
	);
}

const USAGE = `Usage:
  ELEVENLABS_API_KEY=... npx tsx social/scripts/audition-voices.ts \\
    --epictetus voiceIdA,voiceIdB \\
    --marcus-aurelius voiceIdC,voiceIdD \\
    --seneca voiceIdE,voiceIdF

At least one --<author> flag (epictetus, marcus-aurelius, seneca) is required.`;

async function main(): Promise<void> {
	// Read at run time, inside main() — never at module top-level/import time.
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		console.error('ELEVENLABS_API_KEY is not set. This script makes live ElevenLabs API calls and cannot run without it.');
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}

	let candidatesByAuthor: Partial<Record<AuthorSlug, string[]>>;
	try {
		candidatesByAuthor = parseCandidates(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}

	const authorsToAudition = ALL_AUTHORS.filter((author) => candidatesByAuthor[author]);
	if (authorsToAudition.length === 0) {
		console.error('No candidate voice ids given.');
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}

	const client = new ElevenLabsClient({ apiKey });
	// A real ElevenLabsClient satisfies ElevenLabsTtsClient structurally —
	// see the interface's doc comment in tts.ts.
	const provider = new ElevenLabsProvider(client);

	await mkdir(AUDITION_OUT_DIR, { recursive: true });

	const results: AuditionResult[] = [];
	for (const author of authorsToAudition) {
		const passage = FIXED_PASSAGES[author];
		for (const voiceId of candidatesByAuthor[author] ?? []) {
			const outPath = path.join(AUDITION_OUT_DIR, `${author}--${voiceId}.wav`);
			const voice: TtsVoice = { provider: 'elevenlabs', voiceId, label: `${author} candidate (audition)` };
			console.log(`Synthesizing ${author} / ${voiceId} -> ${outPath}`);
			await provider.synthesize(passage.text, voice, outPath);
			results.push({ author, voiceId, cardId: passage.cardId, outPath });
		}
	}

	printResultTable(results);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
