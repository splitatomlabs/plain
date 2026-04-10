<script>
	import TagPill from '$lib/components/TagPill.svelte';
	import GiftBanner from '$lib/components/GiftBanner.svelte';
	import { progress } from '$lib/stores/progress.js';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	let { data } = $props();

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};

	let isGift = $state(false);
	let giftNote = $state('');
	let bookResumeUrl = $state(null);
	let bookPercentage = $state(0);
	let bookCompleted = $state(false);

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		isGift = params.get('gift') === 'true';
		giftNote = params.get('note') || '';

		const p = progress.getProgress(data.book.slug, data.book.total_cards);
		if (p.cardsRead > 0) {
			bookCompleted = progress.isCompleted(data.book.slug);
			bookPercentage = bookCompleted ? 100 : p.percentage;
			if (!bookCompleted) {
				bookResumeUrl = progress.getResumeUrl(data.book.slug);
			}
		}
	});
	let firstCardUrl = $derived(`/${data.book.slug}/${data.book.chapters[0].slug}/1`);

	let showGiftCompose = $state(false);
	let giftNoteInput = $state('');

	function generateGiftUrl() {
		if (!browser) return '';
		const encoded = btoa(giftNoteInput)
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=/g, '');
		return `${window.location.origin}/${data.book.slug}?gift=true&note=${encoded}`;
	}

	async function shareGiftUrl() {
		const url = generateGiftUrl();
		if (navigator.share) {
			try {
				await navigator.share({
					title: `${data.book.title} — In Plain English`,
					text: giftNoteInput || `Check out ${data.book.title} in plain English`,
					url
				});
			} catch {
				// cancelled
			}
		} else {
			try {
				await navigator.clipboard.writeText(url);
			} catch {
				// unavailable
			}
		}
		showGiftCompose = false;
		giftNoteInput = '';
	}
</script>

<svelte:head>
	<title>{data.book.title} by {data.author.name} — In Plain English</title>
	<meta name="description" content={data.book.description} />
</svelte:head>

<article class="book-landing">
	{#if isGift && giftNote}
		<GiftBanner
			note={giftNote}
			bookTitle={data.book.title}
			authorName={data.author.name}
			bookSlug={data.book.slug}
			{firstCardUrl}
		/>
	{/if}

	<header class="book-header">
		<p class="author-title" style="color: {accentVar[data.author.slug]}">{data.author.title}</p>
		<p class="author-name">{data.author.name}</p>
		<h1 class="book-title">{data.book.title}</h1>
		<p class="book-description">{data.book.description}</p>
	</header>

	{#if data.book.has_author_chapters}
		<section class="chapters">
			<h2 class="chapters-heading">Chapters</h2>
			<ol class="chapter-list">
				{#each data.book.chapters as chapter}
					<li class="chapter-item">
						<span class="chapter-title">{chapter.title}</span>
						<span class="chapter-count">{chapter.card_count} {chapter.card_count === 1 ? 'card' : 'cards'}</span>
					</li>
				{/each}
			</ol>
		</section>
	{:else}
		<section class="sections">
			<h2 class="sections-heading">Sections</h2>
			<ol class="section-list">
				{#each data.sections as section}
					<li class="section-item">
						<span class="section-title">{section.label}</span>
						{#if section.cardCount > 1}
							<span class="section-count">{section.cardCount} {section.cardCount === 1 ? 'card' : 'cards'}</span>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if bookPercentage > 0}
		<div class="book-landing-progress">
			<div class="landing-progress-track">
				<div class="landing-progress-fill" style="width: {bookPercentage}%"></div>
			</div>
			<span class="landing-progress-label">{bookPercentage}%</span>
		</div>
	{/if}
	{#if bookResumeUrl}
		<div class="cta-row">
			<a href={bookResumeUrl} class="cta cta-primary">Continue</a>
		</div>
	{:else}
		<div class="cta-row">
			<a href={firstCardUrl} class="cta">{bookCompleted ? 'Read again' : 'Start Reading'}</a>
		</div>
	{/if}

	<div class="gift-row">
		<button class="gift-button" onclick={() => showGiftCompose = !showGiftCompose}>
			Send this book to a friend
		</button>
	</div>

	{#if showGiftCompose}
		<div class="gift-compose">
			<label for="gift-note" class="gift-label">Add a personal note (optional)</label>
			<textarea
				id="gift-note"
				class="gift-textarea"
				bind:value={giftNoteInput}
				maxlength="280"
				placeholder="I thought you'd enjoy this..."
				rows="3"
			></textarea>
			<p class="gift-char-count">{giftNoteInput.length} / 280</p>
			<button class="gift-send" onclick={shareGiftUrl}>Share gift link</button>
		</div>
	{/if}

	{#if data.tags.length > 0}
		<div class="book-tags">
			{#each data.tags as tag}
				<TagPill slug={tag.slug} label={tag.label} />
			{/each}
		</div>
	{/if}
</article>

<style>
	.book-landing {
		max-width: var(--max-line-width);
		margin: 0 auto;
		padding: var(--space-xl) 0;
	}

	.book-header {
		margin-bottom: var(--space-xl);
	}

	.author-title {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-xs);
	}

	.author-name {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
	}

	.book-title {
		font-family: var(--font-body);
		font-size: clamp(1.75rem, 3vw + 0.5rem, 2.5rem);
		font-weight: 400;
		line-height: 1.2;
		margin: 0 0 var(--space-md);
		color: var(--color-text-primary);
	}

	.book-description {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0;
		line-height: var(--line-height-body);
	}

	.sections {
		margin-bottom: var(--space-xl);
	}

	.sections-heading {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
	}

	.section-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.section-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-sm) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.section-title {
		font-family: var(--font-body);
		color: var(--color-text-primary);
	}

	.section-count {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}

	.book-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		margin-top: var(--space-xl);
	}

	.chapters {
		margin-bottom: var(--space-xl);
	}

	.chapters-heading {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
	}

	.chapter-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.chapter-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-sm) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.chapter-title {
		font-family: var(--font-body);
		color: var(--color-text-primary);
	}

	.chapter-count {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}

	.book-landing-progress {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		max-width: 300px;
		margin: 0 auto var(--space-md);
	}

	.landing-progress-track {
		flex: 1;
		height: 4px;
		background: var(--color-border);
		border-radius: 2px;
		overflow: hidden;
	}

	.landing-progress-fill {
		height: 100%;
		background: var(--color-text-secondary);
		border-radius: 2px;
	}

	.landing-progress-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.cta-row {
		text-align: center;
	}

	.cta-secondary-row {
		margin-top: var(--space-sm);
	}

	.cta-primary {
		color: var(--color-surface);
		background: var(--color-text-primary);
		border-color: var(--color-text-primary);
	}

	.cta-primary:hover {
		opacity: 0.85;
		background: var(--color-text-primary);
		border-color: var(--color-text-primary);
	}

	.cta-secondary {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.cta-secondary:hover {
		color: var(--color-text-primary);
	}

	.gift-row {
		text-align: center;
		margin-top: var(--space-sm);
	}

	.cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-sm) var(--space-xl);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		color: var(--color-text-primary);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		text-decoration: none;
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}

	.cta:hover {
		border-color: var(--color-text-secondary);
		background: var(--color-tag-bg);
	}

	.gift-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-sm) var(--space-lg);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.gift-button:hover {
		color: var(--color-text-primary);
	}

	.gift-compose {
		max-width: 400px;
		margin: var(--space-md) auto 0;
		text-align: left;
	}

	.gift-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		display: block;
		margin-bottom: var(--space-sm);
	}

	.gift-textarea {
		width: 100%;
		font-family: var(--font-body);
		font-size: 1rem;
		color: var(--color-text-primary);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: var(--space-sm);
		resize: vertical;
	}

	.gift-textarea:focus {
		outline: 2px solid var(--color-text-secondary);
		outline-offset: 2px;
	}

	.gift-char-count {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-tertiary);
		text-align: right;
		margin: var(--space-xs) 0 var(--space-sm);
	}

	.gift-send {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-sm) var(--space-lg);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		color: var(--color-surface);
		background: var(--color-text-primary);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: opacity var(--transition-fast);
	}

	.gift-send:hover {
		opacity: 0.85;
	}
</style>
