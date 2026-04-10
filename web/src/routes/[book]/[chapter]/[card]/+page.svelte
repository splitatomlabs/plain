<script>
	import Card from '$lib/components/Card.svelte';
	import CardNav from '$lib/components/CardNav.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import MilestoneModal from '$lib/components/MilestoneModal.svelte';
	import { progress } from '$lib/stores/progress.js';
	import { browser } from '$app/environment';

	let { data } = $props();
	let showMilestone = $state(null);

	const MILESTONES = [25, 50, 75, 100];

	function handleNavigateNext() {
		const beforeProgress = progress.getProgress(data.card.book_slug, data.totalCards);
		progress.markCardRead(data.card.book_slug, data.card.id);
		const afterProgress = progress.getProgress(data.card.book_slug, data.totalCards);

		for (const threshold of MILESTONES) {
			if (beforeProgress.percentage < threshold && afterProgress.percentage >= threshold) {
				if (browser) {
					const shown = JSON.parse(localStorage.getItem('plain-milestones') || '{}');
					if (!shown[data.card.book_slug]?.includes(threshold)) {
						showMilestone = threshold;
						break;
					}
				}
			}
		}
	}

	function closeMilestone() {
		showMilestone = null;
	}
</script>

<svelte:head>
	<title>{data.card.source_reference} — In Plain English</title>
	<meta name="description" content={data.card.plain_english.slice(0, 155)} />

	<meta property="og:title" content="{data.card.source_reference} — In Plain English" />
	<meta property="og:description" content={data.card.plain_english.slice(0, 155)} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://plainenglish.app/{data.card.book_slug}/{data.card.chapter_slug}/{data.card.card_number}" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{data.card.source_reference} — In Plain English" />
	<meta name="twitter:description" content={data.card.plain_english.slice(0, 155)} />
</svelte:head>

<ProgressBar
	current={data.cardIndex}
	total={data.totalCards}
	authorSlug={data.book.author_slug}
/>

<div class="card-page">
	{#if !data.prevCard}
		<p class="card-boundary">Beginning of {data.book.title}</p>
	{/if}

	<CardNav prevCard={data.prevCard} nextCard={data.nextCard} onNavigateNext={handleNavigateNext}>
		<Card card={data.card} book={data.book} totalCardsInBook={data.totalCards} cardIndex={data.cardIndex} />
	</CardNav>

	{#if !data.nextCard}
		<div class="card-completion">
			<p class="completion-text">You've finished {data.book.title}.</p>
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
		margin: 0;
	}
</style>
