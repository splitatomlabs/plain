<script>
	let { data } = $props();

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};
</script>

<svelte:head>
	<title>{data.tag.label} — In Plain English</title>
	<meta name="description" content="Stoic wisdom on {data.tag.label.toLowerCase()} from Epictetus, Marcus Aurelius, and Seneca — in plain English." />
</svelte:head>

<article class="tag-page">
	<header class="tag-header">
		<h1>{data.tag.label}</h1>
		<p class="subtitle">
			Here's what the slave, the emperor, and the senator each had to say about {data.tag.label.toLowerCase()}.
		</p>
	</header>

	{#each data.grouped as group}
		<section class="author-group">
			<h2 class="author-heading" style="color: {accentVar[group.author.slug]}">
				{group.author.title} — {group.author.name}
			</h2>
			<div class="card-list">
				{#each group.cards as card}
					<a href="/{card.book_slug}/{card.chapter_slug}/{card.card_number}" class="card-preview">
						<p class="card-text">{card.plain_english}</p>
						<span class="card-source">{card.source_reference}</span>
					</a>
				{/each}
			</div>
		</section>
	{/each}
</article>

<style>
	.tag-page {
		max-width: var(--max-line-width);
		margin: 0 auto;
		padding: var(--space-xl) 0;
	}

	.tag-header {
		margin-bottom: var(--space-2xl);
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
		margin: 0;
	}

	.author-group {
		margin-bottom: var(--space-2xl);
	}

	.author-heading {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-md);
	}

	.card-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
	}

	.card-preview {
		display: block;
		padding: var(--space-lg);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		text-decoration: none;
		transition: border-color var(--transition-fast);
	}

	.card-preview:hover {
		border-color: var(--color-text-secondary);
	}

	.card-text {
		font-family: var(--font-body);
		font-size: var(--text-body);
		line-height: var(--line-height-body);
		color: var(--color-text-primary);
		margin: 0 0 var(--space-sm);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-source {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}
</style>
