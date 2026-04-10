<script>
	import TagPill from './TagPill.svelte';
	import { getTagBySlug } from '$lib/utils/tags.js';

	let { card, book, totalCardsInBook } = $props();

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

	const cardIndex = $derived(getCardIndex());

	function getCardIndex() {
		let index = 0;
		for (const ch of book.chapters) {
			if (ch.slug === card.chapter_slug) {
				return index + card.card_number;
			}
			index += ch.card_count;
		}
		return index + card.card_number;
	}
</script>

<article class="card" aria-live="polite">
	<header class="card-author" style="color: {accentVar[card.author_slug]}">
		{card.author_slug === 'marcus-aurelius' ? 'Marcus Aurelius' :
		 card.author_slug === 'epictetus' ? 'Epictetus' : 'Seneca'}
		 — {authorTitles[card.author_slug]}
	</header>

	<div class="card-text">
		{card.plain_english}
	</div>

	<details class="card-original">
		<summary>Show original</summary>
		<blockquote class="original-text">
			{card.original_excerpt}
		</blockquote>
	</details>

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

		<p class="card-position">{cardIndex} / {totalCardsInBook}</p>
	</footer>
</article>

<style>
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: var(--space-xl) var(--space-lg);
		max-width: var(--max-line-width);
		margin: 0 auto;
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
		line-height: var(--line-height-body);
		color: var(--color-text-primary);
		margin-bottom: var(--space-lg);
	}

	.card-original {
		margin-bottom: var(--space-lg);
	}

	.card-original summary {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		cursor: pointer;
		list-style: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-xs) 0;
		min-height: 44px;
	}

	.card-original summary::-webkit-details-marker {
		display: none;
	}

	.card-original summary::before {
		content: '\25B6';
		font-size: 0.6em;
		transition: transform var(--transition-fast);
	}

	.card-original[open] summary::before {
		transform: rotate(90deg);
	}

	.original-text {
		font-family: var(--font-body);
		font-size: var(--text-original);
		font-style: italic;
		line-height: var(--line-height-body);
		color: var(--color-text-secondary);
		margin: var(--space-sm) 0 0;
		padding-left: var(--space-md);
		border-left: 2px solid var(--color-border);
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

	.card-position {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0;
		text-align: right;
	}
</style>
