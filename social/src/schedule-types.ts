/**
 * Local mirror of `scripts/lib/schedule.ts`'s `WeekSchedule`/`ScheduleSlot`/
 * `SlotContent` shapes — the JSON structure of `content/social/
 * pilot-schedule-w<NN>.json`.
 *
 * Deliberately NOT imported from `scripts/lib/schedule.ts`: `social/` is a
 * self-contained npm project (see T01's own scope note, and
 * `social/src/render/post-metadata.ts`'s `PostFormat` doing the same thing
 * for `ScheduleFormat`) with its own `package.json`/`tsconfig.json`, not a
 * root workspace member, so it does not depend on the root content-pipeline
 * package. A parsed `pilot-schedule-w<NN>.json` file satisfies these
 * interfaces structurally regardless of which package defined them.
 */

export type ScheduleFormat = 'wall' | 'question' | 'objection';

export interface WallSlotContent {
	format: 'wall';
	original_excerpt: string;
	landing_line: string;
}

export interface QuestionSlotContent {
	format: 'question';
	question: string;
	answer: string;
}

export interface ObjectionSlotContent {
	format: 'objection';
	objection: string;
	reply: string;
}

export type SlotContent = WallSlotContent | QuestionSlotContent | ObjectionSlotContent;

export interface ScheduleSlot {
	/** 1-based, 1-7. */
	day: number;
	/** 1-based, 1-2 (slot 1 is always the read-through slot). */
	slot: number;
	card_id: string;
	book_slug: string;
	author_slug: string;
	content: SlotContent;
	read_through: boolean;
	/** e.g. `"Card 5 of 48"`. `null` when `read_through` is false. */
	read_through_counter: string | null;
}

export interface WeekSchedule {
	week: number;
	slots: ScheduleSlot[];
	[key: string]: unknown;
}
