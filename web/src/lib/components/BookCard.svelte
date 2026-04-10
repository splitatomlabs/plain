<script>
	let { book, resumeUrl = null, percentage = 0 } = $props();

	const hasProgress = resumeUrl && percentage > 0;
	const startUrl = `/${book.slug}/${book.chapters[0].slug}/1`;
</script>

<article class="book-card">
	<h3 class="book-title"><a href="/{book.slug}" class="title-link">{book.title}</a></h3>
	<p class="book-description">{book.description}</p>
	{#if hasProgress}
		<div class="book-progress">
			<div class="progress-track">
				<div class="progress-fill" style="width: {percentage}%"></div>
			</div>
			<span class="progress-label">{percentage}%</span>
		</div>
		<a href={resumeUrl} class="cta">Continue</a>
	{:else}
		<a href={startUrl} class="cta">Start Reading</a>
	{/if}
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
		text-decoration: underline;
		text-decoration-color: var(--color-border);
		text-underline-offset: 0.15em;
		transition: text-decoration-color var(--transition-fast);
	}

	.title-link:hover {
		text-decoration-color: var(--color-text-secondary);
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

	.book-progress {
		display: flex;
		align-items: center;
		gap: var(--space-sm);
		margin-bottom: var(--space-md);
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
		transition: border-color var(--transition-fast), background var(--transition-fast);
	}

	.cta:hover {
		border-color: var(--color-text-secondary);
		background: var(--color-tag-bg);
	}
</style>
