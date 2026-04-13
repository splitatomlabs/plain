<script>
	let { book, card, prevCard } = $props();

	const showMarker = $derived(
		book?.has_chapters &&
		prevCard &&
		card.chapter_slug !== prevCard.chapter_slug
	);

	const chapterTitle = $derived(
		showMarker
			? book.chapters?.find((ch) => ch.slug === card.chapter_slug)?.title ?? ''
			: ''
	);
</script>

{#if showMarker}
	<p class="chapter-marker">
		{chapterTitle}
	</p>
{/if}

<style>
	.chapter-marker {
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw + 0.5rem, 2rem);
		font-weight: 400;
		color: var(--color-text-primary);
		text-align: center;
		margin: 0 0 var(--space-lg);
		animation: fade-in var(--transition-normal) ease-out;
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.chapter-marker {
			animation: none;
		}
	}
</style>
