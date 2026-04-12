<script>
	let { book, card, prevCard } = $props();

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};

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
	<p class="chapter-marker" style="color: {accentVar[book.author_slug]}">
		{chapterTitle}
	</p>
{/if}

<style>
	.chapter-marker {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-align: center;
		margin: 0 0 var(--space-md);
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
