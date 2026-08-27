/**
 * Local mirror of `scripts/lib/schedule.ts`'s `WeekSchedule`/`ScheduleSlot`/
 * `WallSlotContent` shapes — the JSON structure of `content/social/
 * pilot-schedule-w<NN>.json`.
 *
 * Deliberately NOT imported from `scripts/lib/schedule.ts`: `social/` is a
 * self-contained npm project (see T01's own scope note, and
 * `social/src/render/post-metadata.ts`'s `PostFormat` doing the same thing)
 * with its own `package.json`/`tsconfig.json`, not a root workspace member,
 * so it does not depend on the root content-pipeline package. A parsed
 * `pilot-schedule-w<NN>.json` file satisfies these interfaces structurally
 * regardless of which package defined them.
 *
 * Pf39c2-social-pilot-02a D01 deleted Question, Objection and Still
 * outright; D02 deleted the read-through and collapsed each day to a
 * SINGLE Wall slot — `ScheduleFormat` narrows to `'wall'`, `SlotContent`
 * narrows to `WallSlotContent`, and `ScheduleSlot` loses `slot`,
 * `read_through` and `read_through_counter`. D03 deleted the read-through
 * counter's renderer machinery too (`Counter.tsx`/`counter-layout.ts`, and
 * the `counter` prop `Wall.tsx`/`cli.ts` used to thread through) — a
 * schedule produced by the new generator never carried one anyway.
 */

export type ScheduleFormat = 'wall';

export interface WallSlotContent {
	format: 'wall';
	original_excerpt: string;
	landing_line: string;
}

export type SlotContent = WallSlotContent;

export interface ScheduleSlot {
	/** 1-based, 1-7. */
	day: number;
	card_id: string;
	book_slug: string;
	author_slug: string;
	content: SlotContent;
}

export interface WeekSchedule {
	week: number;
	slots: ScheduleSlot[];
	[key: string]: unknown;
}
