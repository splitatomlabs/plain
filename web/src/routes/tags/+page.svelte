<script>
	let { data } = $props();
</script>

<svelte:head>
	<title>Topics — In Plain English</title>
	<meta name="description" content="Explore what the slave, the emperor, and the senator each had to say about life's biggest topics." />
</svelte:head>

<article class="tag-index">
	<h1>Topics</h1>
	<p class="subtitle">Explore what the slave, the emperor, and the senator each had to say.</p>

	<div class="tag-grid">
		{#each data.tags as tag}
			<a href="/tags/{tag.slug}" class="tag-card">
				<span class="tag-label">{tag.label}</span>
				<span class="tag-count">{tag.count} {tag.count === 1 ? 'card' : 'cards'}</span>
			</a>
		{/each}
	</div>
</article>

<style>
	.tag-index {
		max-width: 72rem;
		margin: 0 auto;
		padding: var(--space-xl) 0;
	}

	h1 {
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw + 0.5rem, 2rem);
		font-weight: 400;
		margin: 0 0 var(--space-sm);
		color: var(--color-text-primary);
	}

	.subtitle {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-xl);
	}

	.tag-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--space-md);
	}

	.tag-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		padding: var(--space-lg);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		text-decoration: none;
		transition: border-color var(--transition-fast);
	}

	.tag-card:hover {
		border-color: var(--color-text-secondary);
	}

	.tag-label {
		font-family: var(--font-body);
		font-size: 1.125rem;
		color: var(--color-text-primary);
	}

	.tag-count {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}
</style>
