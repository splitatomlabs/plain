<script>
	import { goto, afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';

	let { prevCard, nextCard, children } = $props();

	const SWIPE_THRESHOLD = 50;
	let startX = 0;
	let startY = 0;
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

	function handleSwipeStart(x, y) {
		startX = x;
		startY = y;
	}

	function handleSwipeEnd(x, y) {
		const deltaX = x - startX;
		const deltaY = y - startY;

		if (Math.abs(deltaX) > SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
			if (deltaX < 0) navigateNext();
			else navigatePrev();
		}
	}

	function handleTouchStart(e) {
		handleSwipeStart(e.touches[0].clientX, e.touches[0].clientY);
	}

	function handleTouchEnd(e) {
		handleSwipeEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
	}

	function handlePointerDown(e) {
		if (e.pointerType === 'touch') return; // handled by touch events
		handleSwipeStart(e.clientX, e.clientY);
	}

	function handlePointerUp(e) {
		if (e.pointerType === 'touch') return;
		handleSwipeEnd(e.clientX, e.clientY);
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
	onpointerdown={handlePointerDown}
	onpointerup={handlePointerUp}
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
		display: flex;
		align-items: center;
		flex-shrink: 0;
		text-decoration: none;
		color: var(--color-text-tertiary);
		transition: color var(--transition-fast);
		min-width: 44px;
		min-height: 44px;
		padding: var(--space-sm);
	}

	.nav-zone:hover {
		color: var(--color-text-primary);
	}

	.nav-prev {
		justify-content: flex-start;
	}

	.nav-next {
		justify-content: flex-end;
	}

	.nav-chevron {
		font-size: 2.5rem;
		line-height: 1;
		pointer-events: none;
	}

	.card-content {
		flex: 1;
		min-width: 0;
	}
</style>
