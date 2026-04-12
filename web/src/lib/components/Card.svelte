<script>
	import TagPill from './TagPill.svelte';
	import ShareButton from './ShareButton.svelte';
	import { getTagBySlug } from '$lib/utils/tags.js';

	import { onMount } from 'svelte';

	let { card, book, totalCardsInBook, cardIndex, muted = false } = $props();

	let flipped = $state(false);
	let frontEl = $state(null);
	let backEl = $state(null);
	let innerHeight = $state(null);

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};

	const authorTitles = {
		epictetus: 'The Slave',
		'marcus-aurelius': 'The Emperor',
		seneca: 'The Senator'
	};

	const authorNames = {
		epictetus: 'Epictetus',
		'marcus-aurelius': 'Marcus Aurelius',
		seneca: 'Seneca'
	};

	const paragraphs = $derived(card.plain_english.split('\n\n'));
	const originalParagraphs = $derived(card.original_excerpt.split('\n\n'));

	// Chapter-aware position
	const chapterInfo = $derived(
		book?.has_chapters
			? book.chapters?.find((ch) => ch.slug === card.chapter_slug)
			: null
	);
	const chapterTitle = $derived(chapterInfo?.title);
	const chapterCardCount = $derived(chapterInfo?.card_count ?? card.total_cards_in_chapter);

	function formatReadingTime(seconds) {
		if (seconds < 60) return `~${seconds}s`;
		const minutes = Math.round(seconds / 60);
		return `~${minutes}m`;
	}

	// Reset flip when card changes
	$effect(() => {
		card.id;
		flipped = false;
	});

	function measureHeights() {
		if (!frontEl || !backEl) return;
		const frontH = frontEl.scrollHeight;
		const backH = backEl.scrollHeight;
		innerHeight = flipped ? backH : frontH;
	}

	// Measure on mount and resize
	onMount(() => {
		measureHeights();
		const onResize = () => measureHeights();
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});

	// Re-measure when flip state or card changes
	$effect(() => {
		flipped;
		card.id;
		// Wait a tick so DOM updates before measuring
		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(() => measureHeights());
		}
	});
</script>

<article
	class="card"
	class:card-muted={muted}
	aria-live={muted ? undefined : 'polite'}
	inert={muted ? true : undefined}
>
	<div class="card-perspective">
		<div class="card-inner" class:flipped style={innerHeight ? `height: ${innerHeight}px` : ''}>
			<!-- Front face -->
			<div class="card-front" bind:this={frontEl}>
				<header class="card-author" style="color: {accentVar[card.author_slug]}">
					{authorNames[card.author_slug]} — {authorTitles[card.author_slug]}
				</header>

				<div class="card-text">
					{#each paragraphs as paragraph}
						<p>{paragraph}</p>
					{/each}
				</div>

				{#if !muted}
				<button
					class="flip-btn"
					onclick={() => { flipped = true; }}
					aria-label="Show original text"
				>
					Show original ↻
				</button>
				{/if}

				<footer class="card-footer">
					<p class="card-source">{card.source_reference}</p>

					{#if card.tags?.length}
					<div class="card-tags">
						{#each card.tags as tagSlug}
							{@const tag = getTagBySlug(tagSlug)}
							{#if tag}
								<TagPill slug={tag.slug} label={tag.label} />
							{/if}
						{/each}
					</div>
					{/if}

					<div class="card-actions">
						<ShareButton
							title="{card.source_reference} — In Plain English"
							text={card.plain_english.slice(0, 100)}
							url="https://plainenglish.app/{card.book_slug}/{card.chapter_slug}/{card.card_number}"
						/>
						<span class="reading-time" aria-label="Estimated reading time">{formatReadingTime(card.reading_time_seconds)}</span>
						<span class="card-position">{#if chapterTitle}<span class="chapter-label" style="color: {accentVar[card.author_slug]}">{chapterTitle}</span> · {card.card_number} / {chapterCardCount}{:else}{cardIndex} / {totalCardsInBook}{/if}</span>
					</div>
				</footer>
			</div>

			<!-- Back face -->
			<div class="card-back" bind:this={backEl}>
				<span class="card-face-label">Original</span>
				<header class="card-author" style="color: {accentVar[card.author_slug]}">
					{authorNames[card.author_slug]} — {authorTitles[card.author_slug]}
				</header>

				<div class="card-text">
					{#each originalParagraphs as paragraph}
						<p>{paragraph}</p>
					{/each}
				</div>

				<button
					class="flip-btn"
					onclick={() => { flipped = false; }}
					aria-label="Show plain English"
				>
					Show plain English ↻
				</button>

				<footer class="card-footer">
					<div class="card-actions">
						<span class="card-source">{card.source_reference}</span>
						<span class="card-position">{#if chapterTitle}<span class="chapter-label" style="color: {accentVar[card.author_slug]}">{chapterTitle}</span> · {card.card_number} / {chapterCardCount}{:else}{cardIndex} / {totalCardsInBook}{/if}</span>
					</div>
				</footer>
			</div>
		</div>
	</div>
</article>

<style>
	.card {
		max-width: var(--max-line-width);
		margin: 0 auto;
	}

	.card:focus {
		outline: none;
	}

	.card-perspective {
		perspective: 1000px;
	}

	.card-inner {
		position: relative;
		transform-style: preserve-3d;
		transition: transform var(--transition-flip), height var(--transition-flip);
	}

	.card-inner.flipped {
		transform: rotateY(180deg);
	}

	.card-front,
	.card-back {
		backface-visibility: hidden;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0;
		padding: var(--space-xl) var(--space-md);
	}

	@media (min-width: 768px) {
		.card-front,
		.card-back {
			border-radius: 12px;
			padding: var(--space-2xl) var(--space-xl);
		}
	}

	.card-back {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		transform: rotateY(180deg);
		pointer-events: none;
		background: var(--color-background);
	}

	.card-face-label {
		position: absolute;
		top: var(--space-md);
		right: var(--space-md);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		pointer-events: none;
	}

	@media (min-width: 768px) {
		.card-face-label {
			top: var(--space-xl);
			right: var(--space-xl);
		}
	}

	.card-inner.flipped .card-back {
		pointer-events: auto;
	}

	.card-inner.flipped .card-front {
		pointer-events: none;
	}

	/* Muted state */
	.card-muted {
		opacity: 0.4;
	}

	.card-muted .flip-btn,
	.card-muted .card-tags,
	.card-muted .card-actions {
		pointer-events: none;
	}

	.card-author {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		margin-bottom: var(--space-lg);
	}

	.card-text {
		font-family: var(--font-body);
		font-size: var(--text-body);
		line-height: 1.75;
		color: var(--color-text-primary);
		margin-bottom: var(--space-lg);
	}

	.card-text p {
		margin: 0 0 var(--space-md);
	}

	.card-text p:last-child {
		margin-bottom: 0;
	}

	.flip-btn {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		background: none;
		border: none;
		cursor: pointer;
		padding: var(--space-xs) 0;
		min-height: 44px;
		min-width: 44px;
		margin-bottom: var(--space-lg);
		display: inline-flex;
		align-items: center;
	}

	.flip-btn:hover {
		color: var(--color-text-primary);
	}

.card-footer {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-md);
	}

	.card-source {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-sm);
	}

	.card-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		margin-bottom: var(--space-sm);
	}

	.card-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-sm);
	}

	.card-position {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		text-align: right;
	}

	.chapter-label {
		font-weight: 500;
	}


	.reading-time {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}
</style>
