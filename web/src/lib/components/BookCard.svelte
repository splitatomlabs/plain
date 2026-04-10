<script>
	let { book } = $props();
</script>

<article class="book-card">
	<h3 class="book-title"><a href="/{book.slug}" class="title-link">{book.title}</a></h3>
	<p class="book-description">{book.description}</p>
	<a href="/{book.slug}/{book.chapters[0].slug}/1" class="cta">Start Reading</a>
</article>

<style>
	.book-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: var(--space-lg);
	}

	.book-title {
		font-family: var(--font-body);
		font-size: 1.25rem;
		font-weight: 400;
		margin: 0 0 var(--space-sm);
	}

	.title-link {
		color: var(--color-text-primary);
		text-decoration: none;
		transition: color var(--transition-fast);
	}

	.title-link:hover {
		color: var(--color-text-secondary);
	}

	.book-description {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-sm) var(--space-lg);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		color: var(--color-text-primary);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		text-decoration: none;
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}

	.cta:hover {
		border-color: var(--color-text-secondary);
		background: var(--color-tag-bg);
	}
</style>
