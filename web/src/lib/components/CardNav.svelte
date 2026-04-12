<script>
	import { goto, afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { prevCard, nextCard, children, onNavigateNext } = $props();

	let navRef;

	function cardUrl(card) {
		return `/${card.book_slug}/${card.chapter_slug}/${card.card_number}`;
	}

	function navigatePrev() {
		if (prevCard) goto(cardUrl(prevCard));
	}

	function navigateNext() {
		if (nextCard) {
			const defer = onNavigateNext?.();
			if (!defer) goto(cardUrl(nextCard));
		}
	}

	function handleKeydown(e) {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			navigateNext();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			navigatePrev();
		}
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		if (navRef) navRef.dataset.keyboardReady = '';
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	afterNavigate(() => {
		const article = navRef?.querySelector('article');
		if (article) {
			article.setAttribute('tabindex', '-1');
			article.focus({ preventScroll: true });
		}
	});
</script>

<div
	class="card-nav"
	bind:this={navRef}
	role="region"
	aria-label="Card navigation"
>
	{@render children()}

	<nav class="nav-buttons">
		{#if prevCard}
			<a
				href={cardUrl(prevCard)}
				class="nav-btn"
				aria-label="Previous card"
				data-sveltekit-preload-data="hover"
				onclick={(e) => { e.preventDefault(); navigatePrev(); }}
			>
				<span class="nav-chevron" aria-hidden="true">&#8249;</span>
				Previous
			</a>
		{:else}
			<span></span>
		{/if}

		{#if nextCard}
			<a
				href={cardUrl(nextCard)}
				class="nav-btn"
				aria-label="Next card"
				data-sveltekit-preload-data="hover"
				onclick={(e) => { e.preventDefault(); navigateNext(); }}
			>
				Next
				<span class="nav-chevron" aria-hidden="true">&#8250;</span>
			</a>
		{/if}
	</nav>
</div>

<style>
	.card-nav {
		max-width: var(--max-line-width);
		margin: 0 auto;
	}

	.nav-buttons {
		display: flex;
		justify-content: space-between;
		align-items: center;
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
		text-decoration: none;
		border: 1px solid var(--color-border);
		border-radius: 6px;
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
</style>
