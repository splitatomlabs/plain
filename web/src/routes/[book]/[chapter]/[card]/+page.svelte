<script>
	import Card from '$lib/components/Card.svelte';
	import CardNav from '$lib/components/CardNav.svelte';
	import CardSwipe from '$lib/components/CardSwipe.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import ChapterMarker from '$lib/components/ChapterMarker.svelte';
	import MilestoneModal from '$lib/components/MilestoneModal.svelte';
	import { progress } from '$lib/stores/progress.js';
	import { getAdjacentCard, getBookMeta, getCard } from '$lib/utils/content.js';
	import { pushState, goto } from '$app/navigation';
	import { browser } from '$app/environment';

	let { data } = $props();
	let showMilestone = $state(null);

	// Local card state — initialised from server data, updated client-side on swipe
	let activeCard = $state(data.card);
	let nextCard = $state(data.nextCard);
	let prevCard = $state(data.prevCard);
	let cardIndex = $state(data.cardIndex);

	// Reset local state when SvelteKit provides new data (popstate, initial load)
	$effect(() => {
		const id = data.card.id;
		activeCard = data.card;
		nextCard = data.nextCard;
		prevCard = data.prevCard;
		cardIndex = data.cardIndex;
	});

	const MILESTONES = [25, 50, 75, 100];

	function cardUrl(card) {
		return `/${card.book_slug}/${card.chapter_slug}/${card.card_number}`;
	}

	function computeCardIndex(card) {
		const book = getBookMeta(card.book_slug);
		let idx = 0;
		for (const ch of book.chapters) {
			if (ch.slug === card.chapter_slug) {
				idx += card.card_number;
				break;
			}
			idx += ch.card_count;
		}
		return idx;
	}

	function advanceCard() {
		if (!nextCard) return;
		const newActive = nextCard;
		const newNext = getAdjacentCard(newActive.book_slug, newActive.chapter_slug, newActive.card_number, 1);
		const newPrev = activeCard;
		const newIndex = computeCardIndex(newActive);

		activeCard = newActive;
		nextCard = newNext;
		prevCard = newPrev;
		cardIndex = newIndex;

		pushState(cardUrl(newActive), {});
	}

	function advancePrev() {
		if (!prevCard) return;
		const newActive = prevCard;
		const newPrev = getAdjacentCard(newActive.book_slug, newActive.chapter_slug, newActive.card_number, -1);
		const newNext = activeCard;
		const newIndex = computeCardIndex(newActive);

		activeCard = newActive;
		nextCard = newNext;
		prevCard = newPrev;
		cardIndex = newIndex;

		pushState(cardUrl(newActive), {});
	}

	function handleNavigateNext() {
		const beforeProgress = progress.getProgress(activeCard.book_slug, data.totalCards);
		const resumeUrl = nextCard ? cardUrl(nextCard) : null;
		progress.markCardRead(activeCard.book_slug, activeCard.id, resumeUrl);
		const afterProgress = progress.getProgress(activeCard.book_slug, data.totalCards);

		for (const threshold of MILESTONES) {
			if (beforeProgress.percentage < threshold && afterProgress.percentage >= threshold) {
				if (browser) {
					const shown = JSON.parse(localStorage.getItem('plain-milestones') || '{}');
					if (!shown[activeCard.book_slug]?.includes(threshold)) {
						showMilestone = threshold;
						return true; // defer navigation
					}
				}
			}
		}
		return false;
	}

	function handleDismiss() {
		if (!nextCard) return;
		const defer = handleNavigateNext();
		if (!defer) advanceCard();
	}

	function handleFinishBook() {
		progress.markCardRead(activeCard.book_slug, activeCard.id);
		goto(`/completed/${activeCard.book_slug}`);
	}

	function closeMilestone() {
		const milestone = showMilestone;
		showMilestone = null;
		if (milestone === 100 || !nextCard) {
			goto(`/completed/${activeCard.book_slug}`);
		} else if (nextCard) {
			advanceCard();
		}
	}
</script>

<svelte:head>
	<title>{activeCard.source_reference} — In Plain English</title>
	<meta name="description" content={activeCard.plain_english.slice(0, 155)} />

	<meta property="og:title" content="{activeCard.source_reference} — In Plain English" />
	<meta property="og:description" content={activeCard.plain_english.slice(0, 155)} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://plainenglish.app/{activeCard.book_slug}/{activeCard.chapter_slug}/{activeCard.card_number}" />
	<meta property="og:image" content="/api/og/{activeCard.id}" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{activeCard.source_reference} — In Plain English" />
	<meta name="twitter:description" content={activeCard.plain_english.slice(0, 155)} />
	<meta name="twitter:image" content="/api/og/{activeCard.id}" />
</svelte:head>

<ProgressBar
	current={cardIndex}
	total={data.totalCards}
	authorSlug={data.book.author_slug}
	hasChapters={data.book.has_chapters}
	chapters={data.book.chapters}
/>

<div class="card-page">
	<h1 class="visually-hidden">{activeCard.source_reference} — In Plain English</h1>
	{#if !prevCard}
		<p class="card-boundary">Beginning of {data.book.title}</p>
	{/if}

	<ChapterMarker book={data.book} card={activeCard} prevCard={prevCard} />

	<CardSwipe onDismiss={handleDismiss} hasNext={!!nextCard} canSwipe={!!nextCard} cardId={activeCard.id}>
		{#snippet children()}
			<Card card={activeCard} book={data.book} totalCardsInBook={data.totalCards} cardIndex={cardIndex} />
		{/snippet}
		{#snippet nextCardSnippet()}
			{#if nextCard}
				{@const nextIdx = cardIndex + 1}
				<Card card={nextCard} book={data.book} totalCardsInBook={data.totalCards} cardIndex={nextIdx} muted={true} />
			{/if}
		{/snippet}
	</CardSwipe>

	<CardNav prevCard={prevCard} nextCard={nextCard} onNavigateNext={handleNavigateNext} onNavigatePrev={advancePrev} onAdvanceNext={advanceCard}>
		{#snippet children()}{/snippet}
	</CardNav>

	{#if !nextCard}
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
		font-family: var(--font-body);
		font-size: 1.35rem;
		font-weight: 500;
		color: var(--color-text-primary);
		text-align: center;
		margin: 0 0 var(--space-lg);
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
