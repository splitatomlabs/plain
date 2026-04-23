<script>
	import Card from '$lib/components/Card.svelte';
	import CardSwipe from '$lib/components/CardSwipe.svelte';
	import { tagProgress } from '$lib/stores/tagProgress.js';
	import { trackEvent } from '$lib/analytics.js';
	import { browser } from '$app/environment';
	import { tick, untrack } from 'svelte';

	let { data } = $props();

	const TAG_MILESTONES = [10, 25, 50, 100, 200];
	const TAG_MILESTONES_KEY = 'plain-tag-milestones';

	// Local card state — always starts at 0 (sequence is randomized each visit)
	let localIndex = $state(0);
	let showMilestone = $state(null);
	// Locally reordered sequence — unread cards first, then already-read cards
	let sequence = $state(untrack(() => data.sequence));
	let focusInitialized = false;

	const activeCard = $derived(sequence[localIndex] ?? sequence[0]);
	const nextCard = $derived(localIndex < sequence.length - 1 ? sequence[localIndex + 1] : null);
	const prevCard = $derived(localIndex > 0 ? sequence[localIndex - 1] : null);

	let tagCardsRead = $state(0);
	const positionDisplay = $derived(`${localIndex + 1} of ${data.totalCards}`);

	// On card change (next/prev/swipe) move SR focus to the new card's author
	// header — the author differs per card in the tag sequence, so announcing it
	// confirms the nav. On flip, focus the card text instead (same author,
	// different translation). Initial mount skips focus so fresh page loads
	// start at the top. `await tick()` lets Svelte apply inert toggles first so
	// the query picks the active face.
	async function focusActiveFace(selector) {
		if (!browser) return;
		await tick();
		const els = document.querySelectorAll(`.card-swipe-current ${selector}`);
		for (const el of els) {
			if (!el.closest('[inert]')) {
				el.focus({ preventScroll: true });
				return;
			}
		}
	}

	$effect(() => {
		if (!activeCard) return;
		activeCard.id;
		if (!browser) return;
		if (!focusInitialized) {
			focusInitialized = true;
			return;
		}
		focusActiveFace('.card-author');
	});

	function handleFlip() {
		focusActiveFace('.card-text');
	}

	// Reset local state when navigating between tags (same route, new params).
	// Runs on mount and on every tag slug change.
	$effect(() => {
		if (!browser) return;
		const slug = data.tag.slug;
		trackEvent('tag_explored', { tag_id: slug });
		const progress = tagProgress.getTagProgress(slug);
		tagCardsRead = progress.cardsRead;
		// Push already-read cards to the end so the user always starts on unread cards
		const readSet = new Set(progress.cards);
		const unread = data.sequence.filter((c) => !readSet.has(c.id));
		const read = data.sequence.filter((c) => readSet.has(c.id));
		sequence = [...unread, ...read];
		localIndex = 0;
		showMilestone = null;
	});

	function getShownMilestones(tagSlug) {
		try {
			const shown = JSON.parse(localStorage.getItem(TAG_MILESTONES_KEY) || '{}');
			return shown[tagSlug] || [];
		} catch {
			return [];
		}
	}

	function recordMilestone(tagSlug, milestone) {
		try {
			const shown = JSON.parse(localStorage.getItem(TAG_MILESTONES_KEY) || '{}');
			if (!shown[tagSlug]) shown[tagSlug] = [];
			if (!shown[tagSlug].includes(milestone)) {
				shown[tagSlug].push(milestone);
			}
			localStorage.setItem(TAG_MILESTONES_KEY, JSON.stringify(shown));
		} catch {
			// localStorage unavailable
		}
	}

	function checkMilestone(tagSlug, beforeCount, afterCount) {
		const shown = getShownMilestones(tagSlug);
		for (const threshold of TAG_MILESTONES) {
			if (beforeCount < threshold && afterCount >= threshold && !shown.includes(threshold)) {
				return threshold;
			}
		}
		return null;
	}

	function advanceCard() {
		if (!nextCard) return;
		localIndex = localIndex + 1;
	}

	function advancePrev() {
		if (!prevCard) return;
		localIndex = localIndex - 1;
	}

	function markAndCheckMilestone() {
		const beforeCount = tagProgress.getTagProgress(data.tag.slug).cardsRead;
		if (activeCard.tags) {
			for (const tag of activeCard.tags) {
				tagProgress.markTagCardRead(tag, activeCard.id);
			}
		}
		const afterCount = tagProgress.getTagProgress(data.tag.slug).cardsRead;
		tagCardsRead = afterCount;
		const milestone = checkMilestone(data.tag.slug, beforeCount, afterCount);
		if (milestone) {
			recordMilestone(data.tag.slug, milestone);
			showMilestone = milestone;
			return true;
		}
		return false;
	}

	function handleDismiss() {
		if (!nextCard) return;
		const deferred = markAndCheckMilestone();
		if (!deferred) advanceCard();
	}

	function closeMilestone() {
		showMilestone = null;
		if (nextCard) {
			advanceCard();
		}
	}

	function resetToBeginning() {
		localIndex = 0;
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
		<h1 aria-label="{data.tag.label}, {positionDisplay}">{data.tag.label}</h1>
		<p class="tag-progress-count">
			{positionDisplay}
			{#if tagCardsRead > 0}
				<span class="cards-read-badge">{tagCardsRead} read</span>
			{/if}
		</p>
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
					cardIndex={localIndex + 1}
					linkSource={true}
					onFlip={handleFlip}
				/>
			{/snippet}
			{#snippet nextCardSnippet()}
				{#if nextCard}
					<Card
						card={nextCard}
						book={null}
						totalCardsInBook={data.totalCards}
						cardIndex={localIndex + 2}
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

{#if showMilestone}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-backdrop" onclick={closeMilestone} onkeydown={(e) => e.key === 'Escape' && closeMilestone()} role="presentation">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="modal"
			role="alertdialog"
			aria-labelledby="tag-milestone-heading"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 id="tag-milestone-heading" class="modal-heading">
				You've explored {showMilestone} cards on {data.tag.label}
			</h2>
			<button class="modal-button" onclick={closeMilestone}>
				Keep exploring
			</button>
		</div>
	</div>
{/if}

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

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		animation: fade-in var(--transition-fast) ease-out;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: var(--space-2xl) var(--space-xl);
		max-width: 400px;
		width: 90%;
		text-align: center;
		animation: slide-up var(--transition-normal) ease-out;
	}

	@keyframes slide-up {
		from { transform: translateY(16px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}

	.modal-heading {
		font-family: var(--font-body);
		font-size: 1.5rem;
		line-height: 1.3;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-lg);
	}

	.modal-button {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		color: var(--color-surface);
		background: var(--color-text-primary);
		border: none;
		border-radius: 6px;
		padding: var(--space-sm) var(--space-lg);
		min-height: 44px;
		min-width: 44px;
		cursor: pointer;
		transition: opacity var(--transition-fast);
	}

	.modal-button:hover {
		opacity: 0.85;
	}

	@media (prefers-reduced-motion: reduce) {
		.modal-backdrop {
			animation: none;
		}

		.modal {
			animation: none;
		}
	}
</style>
