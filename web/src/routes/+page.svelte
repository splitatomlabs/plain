<script>
	import AuthorSection from '$lib/components/AuthorSection.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>In Plain English — Ancient Stoic philosophy in words anyone can understand</title>
	<meta name="description" content="Read the complete works of Epictetus, Marcus Aurelius, and Seneca — translated into clear, modern English." />
</svelte:head>

<section class="hero">
	<h1>Three men. Three completely different lives. The same philosophy.</h1>
	<p class="subtitle">Ancient philosophy, stripped to its core, in words anyone can understand.</p>
</section>

{#each data.authorData as { author, books }}
	<AuthorSection {author} {books} />
{/each}

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		min-height: 40vh;
		padding: var(--space-xl) var(--space-md);
		margin-bottom: var(--space-2xl);
	}

	h1 {
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw + 0.5rem, 2.5rem);
		font-weight: 400;
		line-height: 1.3;
		max-width: 20ch;
		margin: 0 0 var(--space-lg);
		color: var(--color-text-primary);
	}

	.subtitle {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		max-width: 40ch;
		margin: 0;
	}
</style>
