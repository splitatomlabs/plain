<script>
	import TagPill from './TagPill.svelte';
	import { getTagBySlug } from '$lib/utils/tags.js';

	let { card, book, totalCardsInBook, cardIndex } = $props();

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

	const paragraphs = $derived(card.plain_english.split('\n\n'));
</script>

<article class="card" aria-live="polite">
	<header class="card-author" style="color: {accentVar[card.author_slug]}">
		{card.author_slug === 'marcus-aurelius' ? 'Marcus Aurelius' :
		 card.author_slug === 'epictetus' ? 'Epictetus' : 'Seneca'}
		 — {authorTitles[card.author_slug]}
	</header>

	<div class="card-text">
		{#each paragraphs as paragraph}
			<p>{paragraph}</p>
		{/each}
	</div>

	<details class="card-original">
		<summary>Show original</summary>
		<blockquote class="original-text">
			{#each card.original_excerpt.split('\n\n') as paragraph}
				<p>{paragraph}</p>
			{/each}
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
		border-radius: 0;
		padding: var(--space-xl) var(--space-md);
		max-width: var(--max-line-width);
		margin: 0 auto;
	}

	.card:focus {
		outline: none;
	}

	@media (min-width: 768px) {
		.card {
			border-radius: 12px;
			padding: var(--space-2xl) var(--space-xl);
		}
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

	.card-text p {
		margin: 0 0 var(--space-md);
	}

	.card-text p:last-child {
		margin-bottom: 0;
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

	.original-text p {
		margin: 0 0 var(--space-sm);
	}

	.original-text p:last-child {
		margin-bottom: 0;
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
