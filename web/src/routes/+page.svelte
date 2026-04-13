<script>
	import AuthorSection from '$lib/components/AuthorSection.svelte';
	import ProgressRing from '$lib/components/ProgressRing.svelte';
	import TagIcon from '$lib/components/TagIcon.svelte';
	import { progress } from '$lib/stores/progress.js';
	import { tagProgress } from '$lib/stores/tagProgress.js';
	import { browser } from '$app/environment';

	let { data } = $props();

	let hasProgress = $state(false);
	let lastReadBook = $state(null);
	let resumeUrl = $state(null);
	let authorProgressData = $state([]);
	let bookProgress = $state({});
	let suggestedBook = $state(null);

	$effect(() => {
		if (!browser) return;
		hasProgress = progress.hasAnyProgress();
		if (hasProgress) {
			// Find most recent incomplete book for the Continue Reading banner
			lastReadBook = progress.getLastReadBook();
			if (lastReadBook && progress.isCompleted(lastReadBook)) {
				lastReadBook = null;
			}
			if (lastReadBook) {
				resumeUrl = progress.getResumeUrl(lastReadBook);
				// Fallback: if resume_url is missing (pre-existing progress), link to book page
				if (!resumeUrl) {
					resumeUrl = `/${lastReadBook}`;
				}
			}
			const bp = {};
			authorProgressData = data.returningAuthorData.map(({ author, books }) => {
				const ap = progress.getAuthorProgress(author.slug, books);
				for (const book of books) {
					const p = progress.getProgress(book.slug, book.total_cards);
					if (p.cardsRead > 0) {
						const isBookCompleted = progress.isCompleted(book.slug);
						bp[book.slug] = {
							resumeUrl: isBookCompleted ? null : progress.getResumeUrl(book.slug),
							percentage: isBookCompleted ? 100 : p.percentage,
							completed: isBookCompleted
						};
					}
				}
				return { author, books, ...ap };
			});
			bookProgress = bp;

			// If no book to continue, suggest an unstarted one
			if (!lastReadBook) {
				const allBooks = data.returningAuthorData.flatMap(({ books }) => books);
				suggestedBook = allBooks.find((b) => !bp[b.slug]) || null;
			}
		}
	});

	function getBookMeta(slug) {
		for (const { books } of data.returningAuthorData) {
			const book = books.find((b) => b.slug === slug);
			if (book) return book;
		}
		return null;
	}

	const lastBookMeta = $derived(lastReadBook ? getBookMeta(lastReadBook) : null);

	function getTagCardsRead(tagSlug) {
		if (!browser) return 0;
		return tagProgress.getTagProgress(tagSlug).cardsRead;
	}

	const TAG_MILESTONES = [10, 25, 50, 100];

	function getHighestMilestone(cardsRead) {
		let highest = null;
		for (const m of TAG_MILESTONES) {
			if (cardsRead >= m) highest = m;
		}
		return highest;
	}
</script>

<svelte:head>
	<title>In Plain English — Ancient Stoic philosophy in words anyone can understand</title>
	<meta name="description" content="Read the complete works of Epictetus, Marcus Aurelius, and Seneca — translated into clear, modern English." />
</svelte:head>

{#snippet themesSection(showProgress)}
	<!-- Depends on the #themes anchor being present somewhere below in DOM order.
	     Both hasProgress branches render it, so the hero's "Or explore by theme"
	     anchor link is always valid. -->
	<section class="themes-section" id="themes">
		<h2 class="themes-heading">Browse by theme</h2>
		<div class="themes-icon-grid">
			{#each data.tags as tag}
				{#if showProgress}
					{@const cardsRead = getTagCardsRead(tag.slug)}
					<TagIcon slug={tag.slug} label={tag.label} {cardsRead} milestone={getHighestMilestone(cardsRead)} />
				{:else}
					<TagIcon slug={tag.slug} label={tag.label} />
				{/if}
			{/each}
		</div>
	</section>
{/snippet}

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

		{#if lastBookMeta && resumeUrl}
			<a href={resumeUrl} class="continue-banner">
				<span class="continue-label">Continue Reading</span>
				<span class="continue-book">{lastBookMeta.title}</span>
			</a>
		{:else if suggestedBook}
			<a href="/{suggestedBook.slug}" class="continue-banner">
				<span class="continue-label">Read next</span>
				<span class="continue-book">{suggestedBook.title}</span>
			</a>
		{/if}
		<a href="#themes" class="theme-cta">Or explore by theme</a>
	</section>

	{#each data.returningAuthorData as { author, books }}
		<AuthorSection {author} {books} {bookProgress} />
	{/each}

	{@render themesSection(true)}
{:else}
	<section class="hero">
		<h1>Three men. Three completely different lives. The same philosophy.</h1>
		<p class="subtitle">Ancient philosophy, stripped to its core, in words anyone can understand.</p>
		<a href="#themes" class="theme-cta">Or explore by theme</a>
	</section>

	{#each data.authorData as { author, books }}
		<AuthorSection {author} {books} />
	{/each}

	{@render themesSection(false)}
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
		gap: var(--space-md);
		margin-bottom: var(--space-xl);
		flex-wrap: wrap;
	}

	@media (min-width: 402px) {
		.author-rings {
			flex-wrap: nowrap;
		}
	}

	@media (min-width: 768px) {
		.author-rings {
			gap: var(--space-xl);
		}
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

	.theme-cta {
		display: inline-block;
		margin-top: var(--space-md);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.theme-cta:hover {
		color: var(--color-text-primary);
	}

	.themes-section {
		max-width: 72rem;
		margin: 0 auto;
		padding: var(--space-2xl) 0;
		text-align: center;
	}

	.themes-heading {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-lg);
	}

	.themes-icon-grid {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-md);
		max-width: 28rem;
		margin: 0 auto;
	}

	@media (min-width: 768px) {
		.themes-icon-grid {
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			max-width: 60rem;
			/* gap inherited from base .themes-icon-grid */
		}
	}
</style>
