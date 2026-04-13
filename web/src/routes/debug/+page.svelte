<script>
	import { progress } from '$lib/stores/progress.js';
	import { goto } from '$app/navigation';

	let { data } = $props();

	const MILESTONES_KEY = 'plain-milestones';

	function resetAll() {
		progress.reset();
		try {
			localStorage.removeItem(MILESTONES_KEY);
		} catch {}
	}

	function clearBookMilestones(slug) {
		try {
			const shown = JSON.parse(localStorage.getItem(MILESTONES_KEY) || '{}');
			delete shown[slug];
			localStorage.setItem(MILESTONES_KEY, JSON.stringify(shown));
		} catch {}
	}

	function primeAndJump(book, threshold) {
		const target = Math.floor((book.total_cards * threshold) / 100) - 1;
		const safe = Math.max(0, target);
		progress._debugSetCardsRead(book.slug, safe);
		clearBookMilestones(book.slug);
		const firstChapter = book.chapters[0]?.slug;
		if (firstChapter) {
			goto(`/${book.slug}/${firstChapter}/1`);
		}
	}
</script>

<svelte:head>
	<title>Debug — In Plain English</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="debug-page">
	<h1>Debug</h1>
	<p class="warn">Dev-only tools. Not reachable in production.</p>

	<section class="global">
		<button type="button" class="danger" onclick={resetAll}>Reset all progress</button>
	</section>

	<section class="books">
		<h2>Books</h2>
		{#each data.books as book (book.slug)}
			<div class="book-row">
				<div class="book-head">
					<strong>{book.title}</strong>
					<span class="muted">({book.total_cards} cards)</span>
				</div>
				<div class="actions">
					<a class="btn" href="/completed/{book.slug}">View completion screen</a>
					{#each [25, 50, 75, 100] as t}
						<button type="button" class="btn" onclick={() => primeAndJump(book, t)}>
							Prime {t}%
						</button>
					{/each}
					<button type="button" class="btn" onclick={() => clearBookMilestones(book.slug)}>
						Clear milestone history
					</button>
				</div>
			</div>
		{/each}
	</section>
</div>

<style>
	.debug-page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-xl) var(--space-md);
		font-family: var(--font-ui);
	}

	h1 {
		font-family: var(--font-body);
		font-weight: 400;
	}

	.warn {
		color: var(--color-text-secondary);
		font-size: var(--text-ui);
	}

	.global {
		margin: var(--space-lg) 0;
	}

	.danger {
		font-family: var(--font-ui);
		padding: var(--space-sm) var(--space-md);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	h2 {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 1.25rem;
		margin-top: var(--space-xl);
	}

	.book-row {
		border-top: 1px solid var(--color-border);
		padding: var(--space-md) 0;
	}

	.book-head {
		margin-bottom: var(--space-sm);
	}

	.muted {
		color: var(--color-text-secondary);
		margin-left: var(--space-xs);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-xs);
	}

	.btn {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		padding: 6px 10px;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		color: var(--color-text-primary);
		cursor: pointer;
		text-decoration: none;
	}

	.btn:hover {
		border-color: var(--color-text-secondary);
	}
</style>
