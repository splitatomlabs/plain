<script>
	import Card from '$lib/components/Card.svelte';
	import CardSwipe from '$lib/components/CardSwipe.svelte';
	import { tagProgress } from '$lib/stores/tagProgress.js';
	import { browser } from '$app/environment';

	let { data } = $props();

	// Local card state — mirrors pushState pattern from book card pages.
	// Server provides the full sequence; we track position client-side.
	let localIndex = $state(null);
	const serverTag = $derived(data.tag.slug);

	// Reset local state when server data changes (new tag page, popstate)
	$effect(() => {
		serverTag;
		if (browser) {
			const resumeIdx = tagProgress.getTagResumeIndex(data.tag.slug);
			localIndex = Math.min(resumeIdx, data.sequence.length - 1);
		} else {
			localIndex = 0;
		}
	});

	const currentIndex = $derived(localIndex ?? 0);
	const activeCard = $derived(data.sequence[currentIndex] ?? data.sequence[0]);
	const nextCard = $derived(currentIndex < data.sequence.length - 1 ? data.sequence[currentIndex + 1] : null);
	const prevCard = $derived(currentIndex > 0 ? data.sequence[currentIndex - 1] : null);

	const tagCardsRead = $derived.by(() => {
		if (!browser) return 0;
		return tagProgress.getTagProgress(data.tag.slug).cardsRead;
	});

	function advanceCard() {
		if (!nextCard) return;
		localIndex = currentIndex + 1;
		tagProgress.setTagResumeIndex(data.tag.slug, localIndex);
	}

	function advancePrev() {
		if (!prevCard) return;
		localIndex = currentIndex - 1;
		tagProgress.setTagResumeIndex(data.tag.slug, localIndex);
	}

	function handleDismiss() {
		if (!nextCard) return;
		// Mark the card as read for all its tags
		if (activeCard.tags) {
			for (const tag of activeCard.tags) {
				tagProgress.markTagCardRead(tag, activeCard.id);
			}
		}
		advanceCard();
	}

	function handleLastCard() {
		// Mark the last card read too
		if (activeCard.tags) {
			for (const tag of activeCard.tags) {
				tagProgress.markTagCardRead(tag, activeCard.id);
			}
		}
	}

	function resetToBeginning() {
		localIndex = 0;
		tagProgress.setTagResumeIndex(data.tag.slug, 0);
	}

	function handleKeydown(e) {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			if (nextCard) handleDismiss();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			advancePrev();
		}
	}
</script>

<svelte:head>
	<title>{data.tag.label} — In Plain English</title>
	<meta name="description" content="Stoic wisdom on {data.tag.label.toLowerCase()} from Epictetus, Marcus Aurelius, and Seneca — in plain English." />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="tag-detail">
	<header class="tag-header">
		<h1>{data.tag.label}</h1>
		<p class="tag-progress-count">
			{currentIndex + 1} / {data.totalCards}
			{#if tagCardsRead > 0}
				<span class="cards-read-badge">{tagCardsRead} read</span>
			{/if}
		</p>
		{#if currentIndex > 0}
			<button class="reset-btn" onclick={resetToBeginning}>Start from beginning</button>
		{/if}
	</header>

	{#if activeCard}
		<CardSwipe
			onDismiss={handleDismiss}
			hasNext={!!nextCard}
			canSwipe={!!nextCard}
			cardId={activeCard.id}
		>
			{#snippet children()}
				<Card
					card={activeCard}
					book={null}
					totalCardsInBook={data.totalCards}
					cardIndex={currentIndex + 1}
					linkSource={true}
				/>
			{/snippet}
			{#snippet nextCardSnippet()}
				{#if nextCard}
					<Card
						card={nextCard}
						book={null}
						totalCardsInBook={data.totalCards}
						cardIndex={currentIndex + 2}
						muted={true}
						linkSource={true}
					/>
				{/if}
			{/snippet}
		</CardSwipe>

		<nav class="nav-buttons">
			{#if prevCard}
				<button class="nav-btn" onclick={advancePrev} aria-label="Previous card">
					<span class="nav-chevron" aria-hidden="true">&#8249;</span>
					Previous
				</button>
			{:else}
				<span></span>
			{/if}

			{#if nextCard}
				<button class="nav-btn" onclick={() => handleDismiss()} aria-label="Next card">
					Next
					<span class="nav-chevron" aria-hidden="true">&#8250;</span>
				</button>
			{/if}
		</nav>

		{#if !nextCard}
			<div class="tag-completion">
				<p class="completion-text">You've reached the end of {data.tag.label}.</p>
				<button class="reset-btn" onclick={resetToBeginning}>Start from beginning</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.tag-detail {
		padding: var(--space-xl) 0;
	}

	@media (max-width: 600px) {
		.tag-detail {
			padding: var(--space-sm) 0;
		}
	}

	.tag-header {
		max-width: var(--max-line-width);
		margin: 0 auto var(--space-lg);
		text-align: center;
	}

	h1 {
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw + 0.5rem, 2rem);
		font-weight: 400;
		margin: 0 0 var(--space-xs);
		color: var(--color-text-primary);
	}

	.tag-progress-count {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-sm);
	}

	.cards-read-badge {
		display: inline-block;
		padding: 2px var(--space-xs);
		background: var(--color-border);
		border-radius: 4px;
		font-size: 0.75rem;
	}

	.reset-btn {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		background: none;
		border: none;
		cursor: pointer;
		padding: var(--space-xs) 0;
		margin-top: var(--space-xs);
		transition: color var(--transition-fast);
	}

	.reset-btn:hover {
		color: var(--color-text-primary);
	}

	.nav-buttons {
		display: flex;
		justify-content: space-between;
		align-items: center;
		max-width: var(--max-line-width);
		margin: 0 auto;
		padding: var(--space-lg) 0;
	}

	.nav-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		min-height: 44px;
		min-width: 44px;
		padding: var(--space-sm) var(--space-md);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		cursor: pointer;
		transition: border-color var(--transition-fast), color var(--transition-fast);
	}

	.nav-btn:hover {
		border-color: var(--color-text-secondary);
		color: var(--color-text-primary);
	}

	.nav-chevron {
		font-size: 1.25rem;
		line-height: 1;
	}

	.tag-completion {
		text-align: center;
		padding: var(--space-xl) 0;
	}

	.completion-text {
		font-family: var(--font-body);
		font-size: 1.25rem;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-md);
	}
</style>
