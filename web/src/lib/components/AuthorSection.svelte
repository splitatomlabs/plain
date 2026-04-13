<script>
	import BookCard from './BookCard.svelte';

	let { author, books, bookProgress = {} } = $props();

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};
</script>

<section class="author-section">
	<div class="author-header">
		<h2 class="author-title" style="color: {accentVar[author.slug]}">{author.title}</h2>
		<p class="author-name">{author.name}</p>
		<p class="author-bio">{author.bio}</p>
	</div>
	<div class="author-books">
		{#each books as book}
			<BookCard {book} resumeUrl={bookProgress[book.slug]?.resumeUrl} percentage={bookProgress[book.slug]?.percentage} completed={bookProgress[book.slug]?.completed} />
		{/each}
	</div>
</section>

<style>
	.author-section {
		margin-bottom: var(--space-3xl);
	}

	.author-header {
		margin-bottom: var(--space-lg);
	}

	.author-title {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-xs);
	}

	.author-name {
		font-family: var(--font-body);
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-sm);
	}

	.author-bio {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		max-width: var(--max-line-width);
		margin: 0;
	}

	.author-books {
		display: grid;
		gap: var(--space-md);
	}

	@media (min-width: 768px) {
		.author-books {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.author-books:has(> :only-child) {
			grid-template-columns: 1fr;
		}
	}
</style>
