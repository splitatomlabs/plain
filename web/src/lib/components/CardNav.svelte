<script>
	import { goto, afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { prevCard, nextCard, children } = $props();

	const SWIPE_THRESHOLD = 50;
	let touchStartX = 0;
	let touchStartY = 0;
	let navRef;

	function cardUrl(card) {
		return `/${card.book_slug}/${card.chapter_slug}/${card.card_number}`;
	}

	function navigatePrev() {
		if (prevCard) goto(cardUrl(prevCard));
	}

	function navigateNext() {
		if (nextCard) goto(cardUrl(nextCard));
	}

	function handleTouchStart(e) {
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	}

	function handleTouchEnd(e) {
		const deltaX = e.changedTouches[0].clientX - touchStartX;
		const deltaY = e.changedTouches[0].clientY - touchStartY;

		// Only trigger if horizontal swipe is dominant
		if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
			if (deltaX < 0) navigateNext();
			else navigatePrev();
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
	ontouchstart={handleTouchStart}
	ontouchend={handleTouchEnd}
	role="region"
	aria-label="Card navigation"
>
	{#if prevCard}
		<a
			href={cardUrl(prevCard)}
			class="nav-zone nav-prev"
			aria-label="Previous card"
			data-sveltekit-preload-data="hover"
		>
			<span class="nav-chevron" aria-hidden="true">&#8249;</span>
		</a>
	{/if}

	<div class="card-content">
		{@render children()}
	</div>

	{#if nextCard}
		<a
			href={cardUrl(nextCard)}
			class="nav-zone nav-next"
			aria-label="Next card"
			data-sveltekit-preload-data="hover"
		>
			<span class="nav-chevron" aria-hidden="true">&#8250;</span>
		</a>
	{/if}
</div>

<style>
	.card-nav {
		position: relative;
		display: flex;
		align-items: stretch;
		gap: 0;
	}

	.nav-zone {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 20%;
		display: flex;
		align-items: center;
		z-index: 1;
		text-decoration: none;
		color: var(--color-text-secondary);
		opacity: 0;
		transition: opacity var(--transition-fast);
		min-width: 44px;
		min-height: 44px;
	}

	.nav-zone:hover {
		opacity: 1;
	}

	.nav-prev {
		left: 0;
		justify-content: flex-start;
		padding-left: var(--space-sm);
		cursor: w-resize;
	}

	.nav-next {
		right: 0;
		justify-content: flex-end;
		padding-right: var(--space-sm);
		cursor: e-resize;
	}

	.nav-chevron {
		font-size: 2rem;
		line-height: 1;
		pointer-events: none;
	}

	.card-content {
		flex: 1;
		min-width: 0;
	}

	/* Hide click zones on mobile — swipe handles navigation */
	@media (max-width: 767px) {
		.nav-zone {
			display: none;
		}
	}
</style>
