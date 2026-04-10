<script>
	import TagPill from '$lib/components/TagPill.svelte';

	let { data } = $props();

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};
</script>

<article class="book-landing">
	<header class="book-header">
		<p class="author-title" style="color: {accentVar[data.author.slug]}">{data.author.title}</p>
		<p class="author-name">{data.author.name}</p>
		<h1 class="book-title">{data.book.title}</h1>
		<p class="book-description">{data.book.description}</p>
	</header>

	{#if data.book.has_author_chapters}
		<section class="chapters">
			<h2 class="chapters-heading">Chapters</h2>
			<ol class="chapter-list">
				{#each data.book.chapters as chapter}
					<li class="chapter-item">
						<span class="chapter-title">{chapter.title}</span>
						<span class="chapter-count">{chapter.card_count} {chapter.card_count === 1 ? 'card' : 'cards'}</span>
					</li>
				{/each}
			</ol>
		</section>
	{:else}
		<section class="sections">
			<h2 class="sections-heading">Sections</h2>
			<ol class="section-list">
				{#each data.sections as section}
					<li class="section-item">
						<span class="section-title">{section.label}</span>
						{#if section.cardCount > 1}
							<span class="section-count">{section.cardCount} {section.cardCount === 1 ? 'card' : 'cards'}</span>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	<div class="cta-row">
		<a href="/{data.book.slug}/{data.book.chapters[0].slug}/1" class="cta">Start Reading</a>
	</div>

	{#if data.tags.length > 0}
		<div class="book-tags">
			{#each data.tags as tag}
				<TagPill slug={tag.slug} label={tag.label} />
			{/each}
		</div>
	{/if}
</article>

<style>
	.book-landing {
		max-width: var(--max-line-width);
		margin: 0 auto;
		padding: var(--space-xl) 0;
	}

	.book-header {
		margin-bottom: var(--space-xl);
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
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
	}

	.book-title {
		font-family: var(--font-body);
		font-size: clamp(1.75rem, 3vw + 0.5rem, 2.5rem);
		font-weight: 400;
		line-height: 1.2;
		margin: 0 0 var(--space-md);
		color: var(--color-text-primary);
	}

	.book-description {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0;
		line-height: var(--line-height-body);
	}

	.sections {
		margin-bottom: var(--space-xl);
	}

	.sections-heading {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
	}

	.section-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.section-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-sm) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.section-title {
		font-family: var(--font-body);
		color: var(--color-text-primary);
	}

	.section-count {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}

	.book-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
		margin-top: var(--space-xl);
	}

	.chapters {
		margin-bottom: var(--space-xl);
	}

	.chapters-heading {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
	}

	.chapter-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.chapter-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-sm) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.chapter-title {
		font-family: var(--font-body);
		color: var(--color-text-primary);
	}

	.chapter-count {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}

	.cta-row {
		text-align: center;
	}

	.cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-sm) var(--space-xl);
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
