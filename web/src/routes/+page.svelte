<script>
	import AuthorSection from '$lib/components/AuthorSection.svelte';
	import ProgressRing from '$lib/components/ProgressRing.svelte';
	import { progress } from '$lib/stores/progress.js';
	import { browser } from '$app/environment';

	let { data } = $props();

	let hasProgress = $state(false);
	let lastReadBook = $state(null);
	let lastReadCard = $state(null);
	let authorProgressData = $state([]);

	$effect(() => {
		if (!browser) return;
		hasProgress = progress.hasAnyProgress();
		if (hasProgress) {
			lastReadBook = progress.getLastReadBook();
			if (lastReadBook) {
				const bookProgress = progress.getProgress(lastReadBook, 0);
				lastReadCard = bookProgress.lastCard;
			}
			authorProgressData = data.returningAuthorData.map(({ author, books }) => {
				const ap = progress.getAuthorProgress(author.slug, books);
				return { author, books, ...ap };
			});
		}
	});

	function cardUrl(cardId) {
		if (!cardId) return null;
		// Card ID format: "meditations-01-001" → /meditations/book-01/1
		// or "enchiridion-01-003" → /enchiridion/sections-01-10/3
		// We need the book meta to resolve chapter slug, so link to book page with continue
		return null;
	}

	function getBookMeta(slug) {
		for (const { books } of data.returningAuthorData) {
			const book = books.find((b) => b.slug === slug);
			if (book) return book;
		}
		return null;
	}

	function getLastCardUrl() {
		if (!lastReadCard || !lastReadBook) return null;
		// Parse card ID: "meditations-05-016" → book=meditations, chapter_slug from card ID parts
		const book = getBookMeta(lastReadBook);
		if (!book) return null;
		// Card IDs are like "meditations-01-001" where middle part maps to chapter
		// We need to find the chapter. The card ID contains book-chapterNum-cardNum.
		const parts = lastReadCard.split('-');
		// For compound slugs like "shortness-of-life-01-001", we need the book slug to strip it
		const suffix = lastReadCard.slice(lastReadBook.length + 1); // "01-001"
		const suffixParts = suffix.split('-');
		const chapterNum = suffixParts[0];
		const cardNum = parseInt(suffixParts[1], 10);
		// Find matching chapter
		const chapter = book.chapters.find((ch) => ch.slug.endsWith(chapterNum) || ch.slug.includes(chapterNum));
		if (!chapter) return `/${lastReadBook}`;
		return `/${lastReadBook}/${chapter.slug}/${cardNum}`;
	}

	const lastCardUrl = $derived(getLastCardUrl());
	const lastBookMeta = $derived(lastReadBook ? getBookMeta(lastReadBook) : null);
</script>

<svelte:head>
	<title>In Plain English — Ancient Stoic philosophy in words anyone can understand</title>
	<meta name="description" content="Read the complete works of Epictetus, Marcus Aurelius, and Seneca — translated into clear, modern English." />
</svelte:head>

{#if hasProgress}
	<section class="returning-hero">
		<div class="author-rings">
			{#each authorProgressData as { author, percentage, cardsRead, totalCards }}
				<div class="ring-group">
					<ProgressRing
						{percentage}
						size="medium"
						authorSlug={author.slug}
						label="{author.name}: {cardsRead} of {totalCards} cards read, {percentage}%"
					/>
					<span class="ring-label" style="color: var(--color-accent-{author.slug === 'marcus-aurelius' ? 'marcus' : author.slug})">{author.title}</span>
				</div>
			{/each}
		</div>

		{#if lastBookMeta && lastCardUrl}
			<a href={lastCardUrl} class="continue-banner">
				<span class="continue-label">Continue Reading</span>
				<span class="continue-book">{lastBookMeta.title}</span>
			</a>
		{/if}
	</section>

	{#each data.returningAuthorData as { author, books }}
		<AuthorSection {author} {books} />
	{/each}
{:else}
	<section class="hero">
		<h1>Three men. Three completely different lives. The same philosophy.</h1>
		<p class="subtitle">Ancient philosophy, stripped to its core, in words anyone can understand.</p>
	</section>

	{#each data.authorData as { author, books }}
		<AuthorSection {author} {books} />
	{/each}
{/if}

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 40vh;
		padding: var(--space-xl) var(--space-md);
		margin-bottom: var(--space-2xl);
	}

	h1 {
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw + 0.5rem, 2.5rem);
		font-weight: 400;
		line-height: 1.3;
		max-width: 20ch;
		margin: 0 0 var(--space-lg);
		color: var(--color-text-primary);
	}

	.subtitle {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		max-width: 40ch;
		margin: 0;
	}

	.returning-hero {
		text-align: center;
		padding: var(--space-xl) var(--space-md);
		margin-bottom: var(--space-2xl);
	}

	.author-rings {
		display: flex;
		justify-content: center;
		gap: var(--space-xl);
		margin-bottom: var(--space-xl);
		flex-wrap: wrap;
	}

	.ring-group {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-sm);
	}

	.ring-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.continue-banner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-md) var(--space-lg);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		text-decoration: none;
		max-width: 400px;
		margin: 0 auto;
		min-height: 44px;
		transition: border-color var(--transition-fast);
	}

	.continue-banner:hover {
		border-color: var(--color-text-secondary);
	}

	.continue-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		color: var(--color-text-primary);
	}

	.continue-book {
		font-family: var(--font-body);
		font-size: 1.125rem;
		color: var(--color-text-secondary);
	}
</style>
