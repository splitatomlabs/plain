<script>
	import Card from '$lib/components/Card.svelte';
	import CardNav from '$lib/components/CardNav.svelte';
	import CardSwipe from '$lib/components/CardSwipe.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import ChapterMarker from '$lib/components/ChapterMarker.svelte';
	import MilestoneModal from '$lib/components/MilestoneModal.svelte';
	import { progress } from '$lib/stores/progress.js';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	let { data } = $props();
	let showMilestone = $state(null);

	const MILESTONES = [25, 50, 75, 100];

	function cardUrl(card) {
		return `/${card.book_slug}/${card.chapter_slug}/${card.card_number}`;
	}

	function handleNavigateNext() {
		const beforeProgress = progress.getProgress(data.card.book_slug, data.totalCards);
		const resumeUrl = data.nextCard ? cardUrl(data.nextCard) : null;
		progress.markCardRead(data.card.book_slug, data.card.id, resumeUrl);
		const afterProgress = progress.getProgress(data.card.book_slug, data.totalCards);

		for (const threshold of MILESTONES) {
			if (beforeProgress.percentage < threshold && afterProgress.percentage >= threshold) {
				if (browser) {
					const shown = JSON.parse(localStorage.getItem('plain-milestones') || '{}');
					if (!shown[data.card.book_slug]?.includes(threshold)) {
						showMilestone = threshold;
						return true; // defer navigation
					}
				}
			}
		}
		return false;
	}

	function handleDismiss() {
		if (!data.nextCard) return;
		const defer = handleNavigateNext();
		if (!defer) goto(cardUrl(data.nextCard));
	}

	function handleFinishBook() {
		progress.markCardRead(data.card.book_slug, data.card.id);
		goto(`/completed/${data.card.book_slug}`);
	}

	function closeMilestone() {
		const milestone = showMilestone;
		showMilestone = null;
		if (milestone === 100 || !data.nextCard) {
			goto(`/completed/${data.card.book_slug}`);
		} else if (data.nextCard) {
			goto(cardUrl(data.nextCard));
		}
	}
</script>

<svelte:head>
	<title>{data.card.source_reference} — In Plain English</title>
	<meta name="description" content={data.card.plain_english.slice(0, 155)} />

	<meta property="og:title" content="{data.card.source_reference} — In Plain English" />
	<meta property="og:description" content={data.card.plain_english.slice(0, 155)} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://plainenglish.app/{data.card.book_slug}/{data.card.chapter_slug}/{data.card.card_number}" />
	<meta property="og:image" content="/api/og/{data.card.id}" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{data.card.source_reference} — In Plain English" />
	<meta name="twitter:description" content={data.card.plain_english.slice(0, 155)} />
	<meta name="twitter:image" content="/api/og/{data.card.id}" />
</svelte:head>

<ProgressBar
	current={data.cardIndex}
	total={data.totalCards}
	authorSlug={data.book.author_slug}
	hasChapters={data.book.has_chapters}
	chapters={data.book.chapters}
/>

<div class="card-page">
	<h1 class="visually-hidden">{data.card.source_reference} — In Plain English</h1>
	{#if !data.prevCard}
		<p class="card-boundary">Beginning of {data.book.title}</p>
	{/if}

	<ChapterMarker book={data.book} card={data.card} prevCard={data.prevCard} />

	<CardSwipe onDismiss={handleDismiss} hasNext={!!data.nextCard}>
		{#snippet children()}
			<Card card={data.card} book={data.book} totalCardsInBook={data.totalCards} cardIndex={data.cardIndex} />
		{/snippet}
		{#snippet nextCardSnippet()}
			{#if data.nextCard}
				{@const nextChapterCards = data.book.chapters.find(ch => ch.slug === data.nextCard.chapter_slug)}
				{@const nextCardIndex = data.cardIndex + 1}
				<Card card={data.nextCard} book={data.book} totalCardsInBook={data.totalCards} cardIndex={nextCardIndex} muted={true} />
			{/if}
		{/snippet}
	</CardSwipe>

	<CardNav prevCard={data.prevCard} nextCard={data.nextCard} onNavigateNext={handleNavigateNext}>
		{#snippet children()}{/snippet}
	</CardNav>

	{#if !data.nextCard}
		<div class="card-completion">
			<p class="completion-text">This is the last card in {data.book.title}.</p>
			<button class="finish-button" onclick={handleFinishBook}>Finish book</button>
		</div>
	{/if}
</div>

{#if showMilestone}
	<MilestoneModal
		milestone={showMilestone}
		bookTitle={data.book.title}
		bookSlug={data.book.slug}
		onClose={closeMilestone}
	/>
{/if}

<style>
	.card-page {
		padding: var(--space-xl) 0;
	}

	.card-boundary {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		text-align: center;
		margin: 0 0 var(--space-md);
	}

	.card-completion {
		text-align: center;
		padding: var(--space-xl) 0;
	}

	.completion-text {
		font-family: var(--font-body);
		font-size: 1.25rem;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-md);
	}

	.finish-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-sm) var(--space-xl);
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

	.finish-button:hover {
		opacity: 0.85;
	}
</style>
