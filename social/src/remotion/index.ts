export { RemotionRoot } from './Root.js';
export {
	MIN_POST_DURATION_SECONDS,
	MAX_POST_DURATION_SECONDS,
	MIN_POST_DURATION_FRAMES,
	MAX_POST_DURATION_FRAMES,
	padToMinimumDuration,
	type PaddedDuration
} from './duration-bounds.js';
export {
	SourceHead,
	formatRunningHead,
	SOURCE_HEAD_FONT_STACK,
	PAYOFF_LABEL_TEXT,
	type RunningHeadCardMetadata,
	type SourceHeadVariant,
	type SourceHeadProps
} from './SourceHead.js';
export {
	SOURCE_HEAD_SAFE_INSET_PX,
	SOURCE_HEAD_TOP_PX,
	SOURCE_HEAD_FONT_SIZE_PX,
	SOURCE_HEAD_PAYOFF_FONT_SIZE_PX,
	SOURCE_HEAD_BOUNDING_BOX,
	type SourceHeadBoundingBox
} from './source-head-layout.js';
export {
	Wall,
	WallPhase,
	PayoffLine,
	SERIF_STACK,
	type WallProps
} from './Wall.js';
export {
	computeWallLayout,
	computeWallTiming,
	wallScrollOffsetAtFrame,
	splitWords,
	FPS,
	FRAME_WIDTH,
	FRAME_HEIGHT,
	WALL_MIN_SECONDS,
	WALL_MAX_SECONDS,
	WALL_MIN_FRAMES,
	WALL_MAX_FRAMES,
	WALL_SECONDS,
	WALL_FRAMES,
	WALL_INSET_PX,
	WALL_BOX_WIDTH,
	WALL_FONT_SIZE,
	WALL_SCROLL_LINES_PER_SEC,
	WALL_LINE_ESTIMATE_OVERSHOOT,
	WALL_SCROLL_RATE_PX_PER_SEC,
	WALL_SCROLL_PX_PER_FRAME,
	WALL_LINE_HEIGHT_RATIO,
	PAYOFF_PADDING_X,
	PAYOFF_BOX_WIDTH,
	PAYOFF_BOX_HEIGHT,
	PAYOFF_MIN_FONT,
	PAYOFF_MAX_FONT,
	PAYOFF_LINE_HEIGHT_RATIO,
	LANDING_LINE_SECONDS,
	LANDING_LINE_FRAMES,
	DEFAULT_LINE_SECONDS,
	DEFAULT_LINE_FRAMES,
	type WallLayout,
	type WallPhaseWindow,
	type WallRestLine,
	type WallTimingInput,
	type WallTimingSchedule,
	type NarrationLineTiming,
	computeWallRawTotalFrames
} from './wall-timing.js';
export {
	gateWallCard,
	assertWallCardRenderable,
	WALL_REFERENCE_VIEWPORT_WIDTH,
	WALL_MIN_LEGIBLE_FONT_PX,
	type WallGateResult,
	type WallGateContentInput
} from './wall-gate.js';
export {
	surveyWallPool,
	resolveWallCardExcerpt,
	loadOutputCard,
	type WallPoolEntry,
	type WallPoolSurveyResult,
	type OutputCard
} from './wall-pool.js';
