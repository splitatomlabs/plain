export { RemotionRoot } from './Root.js';
export {
	MIN_POST_DURATION_SECONDS,
	MAX_POST_DURATION_SECONDS,
	MIN_POST_DURATION_FRAMES,
	MAX_POST_DURATION_FRAMES,
	padToMinimumDuration,
	type PaddedDuration
} from './duration-bounds.js';
export { ReadThroughCounter, COUNTER_FONT_STACK, type ReadThroughCounterProps } from './Counter.js';
export {
	COUNTER_SAFE_INSET_PX,
	COUNTER_FONT_SIZE_PX,
	COUNTER_BOUNDING_BOX,
	type CounterBoundingBox
} from './counter-layout.js';
export {
	Wall,
	WallPhase,
	WallOpeningBadge,
	WALL_OPENING_VALUE_FONT_SIZE,
	WALL_OPENING_SUBLABEL_FONT_SIZE,
	WALL_OPENING_REGION_HEIGHT,
	PayoffLine,
	SERIF_STACK,
	type WallProps
} from './Wall.js';
export {
	computeWallLayout,
	computeWallTiming,
	computeKaraokeWordTimings,
	wallScaleAtFrame,
	splitWords,
	FPS,
	FRAME_WIDTH,
	FRAME_HEIGHT,
	KARAOKE_WPM,
	FRAMES_PER_WORD,
	WALL_MIN_SECONDS,
	WALL_MAX_SECONDS,
	WALL_MIN_FRAMES,
	WALL_MAX_FRAMES,
	WALL_SECONDS,
	WALL_FRAMES,
	WALL_SCALE_AT_FRAME_ZERO,
	WALL_SCALE_AT_CUT,
	REST_SCALE,
	WALL_INSET_PX,
	WALL_MAX_CROP_PX,
	WALL_BOX_WIDTH,
	WALL_BOX_HEIGHT,
	WALL_MIN_FONT,
	WALL_MAX_FONT,
	WALL_LINE_HEIGHT_RATIO,
	WALL_MIN_FILL_RATIO,
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
	type KaraokeWordTiming,
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
export {
	computeOpeningData,
	karaokeSweptWordCount,
	countdownValueAtFrame,
	formatCountdownLabel,
	formatGradeLabel,
	GRADE_LABEL_PREFIX,
	gateOpening,
	assertOpeningRenderable,
	rotateOpening,
	computeEligibleOpenings,
	WALL_OPENINGS,
	WALL_COUNTDOWN_DELTA_MIN,
	WALL_ORIGINAL_GRADE_MIN,
	FORBIDDEN_GRADE_VOCABULARY,
	type WallOpening,
	type OpeningData,
	type WallOpeningEligibilityEntry,
	type GateOpeningResult
} from './wall-openings.js';
export { Question, type QuestionProps } from './Question.js';
export {
	computeQuestionTiming,
	computeQuestionLayout,
	QUESTION_HOLD_SECONDS,
	QUESTION_HOLD_FRAMES,
	QUESTION_BOX_PADDING_X,
	QUESTION_BOX_WIDTH,
	QUESTION_BOX_HEIGHT,
	QUESTION_MIN_FONT,
	QUESTION_MAX_FONT,
	QUESTION_LINE_HEIGHT_RATIO,
	ANSWER_MIN_SECONDS,
	ANSWER_SECONDS,
	ANSWER_FRAMES,
	ANSWER_BOX_PADDING_X,
	ANSWER_BOX_WIDTH,
	ANSWER_BOX_HEIGHT,
	ANSWER_MIN_FONT,
	ANSWER_MAX_FONT,
	ANSWER_LINE_HEIGHT_RATIO,
	type QuestionLayout,
	type QuestionPhaseWindow,
	type QuestionTimingInput,
	type QuestionTimingSchedule
} from './question-timing.js';
export {
	gateQuestionCard,
	assertQuestionRenderable,
	QUESTION_MAX_WORDS,
	QUESTION_REFERENCE_VIEWPORT_WIDTH,
	QUESTION_MIN_LEGIBLE_FONT_PX,
	FORBIDDEN_TESTING_VOCABULARY,
	type QuestionGateInput,
	type QuestionGateResult
} from './question-gate.js';
export { Objection, type ObjectionProps } from './Objection.js';
export {
	computeObjectionTiming,
	computeObjectionLayout,
	quoteObjection,
	OBJECTION_MIN_SECONDS,
	OBJECTION_HOLD_SECONDS,
	OBJECTION_HOLD_FRAMES,
	OBJECTION_BOX_PADDING_X,
	OBJECTION_BOX_WIDTH,
	OBJECTION_BOX_HEIGHT,
	OBJECTION_MIN_FONT,
	OBJECTION_MAX_FONT,
	OBJECTION_LINE_HEIGHT_RATIO,
	OBJECTION_REPLY_LINE_COUNT,
	OBJECTION_REPLY_MIN_SECONDS,
	OBJECTION_REPLY_LINE_SECONDS,
	OBJECTION_REPLY_LINE_FRAMES,
	type ObjectionLayout,
	type ObjectionPhaseWindow,
	type ObjectionTimingSchedule
} from './objection-timing.js';
export {
	gateObjectionCard,
	assertObjectionRenderable,
	orderObjectionPool,
	surveyObjectionPool,
	OBJECTION_REFERENCE_VIEWPORT_WIDTH,
	OBJECTION_MIN_LEGIBLE_FONT_PX,
	OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX,
	DISCOURSE_CONNECTIVES,
	type ObjectionGateInput,
	type ObjectionGateResult,
	type ObjectionReplyLineLayout,
	type ObjectionPoolSurveyEntry,
	type ObjectionPoolSurveyResult
} from './objection-gate.js';
