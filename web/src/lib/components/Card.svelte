<script>
	import TagPill from './TagPill.svelte';
	import ShareButton from './ShareButton.svelte';
	import { getTagBySlug } from '$lib/utils/tags.js';
	import { favorites } from '$lib/stores/favorites.js';

	let { card, book, totalCardsInBook, cardIndex } = $props();

	let isFav = $state(false);

	$effect(() => {
		isFav = favorites.isFavorite(card.id);
	});

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

		<div class="card-actions">
			<div class="action-buttons">
				<ShareButton
					title="{card.source_reference} — In Plain English"
					text={card.plain_english.slice(0, 100)}
					url="https://plainenglish.app/{card.book_slug}/{card.chapter_slug}/{card.card_number}"
				/>
				<button
					class="favorite-button"
				class:is-favorite={isFav}
				aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
				onclick={() => { favorites.toggleFavorite(card.id); isFav = favorites.isFavorite(card.id); }}
			>
				{#if isFav}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
					</svg>
				{:else}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
					</svg>
				{/if}
			</button>
			</div>
			<span class="card-position">{cardIndex} / {totalCardsInBook}</span>
		</div>
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

	.card-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.action-buttons {
		display: flex;
		align-items: center;
		gap: var(--space-xs);
	}

	.favorite-button {
		background: none;
		border: none;
		padding: var(--space-xs);
		cursor: pointer;
		color: var(--color-text-secondary);
		min-width: 44px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: color var(--transition-fast);
	}

	.favorite-button:hover {
		color: var(--color-text-primary);
	}

	.favorite-button.is-favorite {
		color: #c44;
	}

	.card-position {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		text-align: right;
	}
</style>
