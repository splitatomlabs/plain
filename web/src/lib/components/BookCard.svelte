<script>
	let { book, resumeUrl = null, percentage = 0, completed = false } = $props();

	const startUrl = $derived(`/${book.slug}/${book.chapters[0].slug}/1`);
	const ctaHref = $derived(resumeUrl && !completed ? resumeUrl : startUrl);
	const ctaLabel = $derived(resumeUrl && !completed ? 'Continue' : completed ? 'Read again' : 'Start Reading');
</script>

<article class="book-card">
	<a href="/{book.slug}" class="card-link" aria-label="About {book.title}"></a>
	<h3 class="book-title">{book.title}</h3>
	<p class="book-description">{book.description}</p>
	{#if percentage > 0}
		<div class="book-progress">
			<div class="progress-track">
				<div class="progress-fill" style="width: {percentage}%"></div>
			</div>
			<span class="progress-label">{percentage}%</span>
		</div>
	{/if}
	<a href={ctaHref} class="cta">{ctaLabel}</a>
</article>

<style>
	.book-card {
		position: relative;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: var(--space-lg);
		cursor: pointer;
		transition: border-color var(--transition-fast);
	}

	.book-card:hover {
		border-color: var(--color-text-secondary);
	}

	.card-link {
		position: absolute;
		inset: 0;
		border-radius: 8px;
		z-index: 0;
	}

	.card-link:focus-visible {
		outline: 2px solid var(--color-text-primary);
		outline-offset: 2px;
	}

	.book-title {
		font-family: var(--font-body);
		font-size: 1.25rem;
		font-weight: 400;
		margin: 0 0 var(--space-sm);
		position: relative;
		z-index: 1;
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
		position: relative;
		z-index: 1;
	}

	.book-progress {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
		position: relative;
		z-index: 1;
	}

	.progress-track {
		flex: 1;
		height: 4px;
		background: var(--color-border);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-text-secondary);
		border-radius: 2px;
		transition: width var(--transition-slow);
	}

	@media (prefers-reduced-motion: reduce) {
		.progress-fill {
			transition: none;
		}
	}

	.progress-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		min-width: 3ch;
		text-align: right;
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
		position: relative;
		z-index: 1;
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}

	.cta:hover {
		border-color: var(--color-text-secondary);
		background: var(--color-tag-bg);
	}
</style>
