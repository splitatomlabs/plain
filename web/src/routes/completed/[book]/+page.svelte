<script>
	import { progress } from '$lib/stores/progress.js';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { trackEvent } from '$lib/analytics.js';

	let { data } = $props();

	let shareConfirm = $state('');

	async function shareCompletion() {
		const url = `${page.url.origin}/${data.book.slug}`;
		const title = `I just finished ${data.book.title} — In Plain English`;
		if (navigator.share) {
			try {
				await navigator.share({ title, url });
				trackEvent('share_clicked', { type: 'completion', book_id: data.book.slug });
			} catch {
				// cancelled
			}
		} else {
			try {
				await navigator.clipboard.writeText(url);
				trackEvent('share_clicked', { type: 'completion', book_id: data.book.slug });
				shareConfirm = 'Link copied';
				setTimeout(() => { shareConfirm = ''; }, 2000);
			} catch {
				// unavailable
			}
		}
	}

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};

	const readingMinutes = Math.ceil((data.book.total_cards * 30) / 60);

	onMount(() => {
		progress.markCompleted(data.book.slug);
	});
</script>

<svelte:head>
	<title>Completed {data.book.title} — In Plain English</title>
	<meta name="description" content="You just read all of {data.book.title} in plain English." />

	<meta property="og:title" content="I just finished {data.book.title} — In Plain English" />
	<meta property="og:description" content="You just read all of {data.book.title} in plain English." />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="{page.url.origin}/{data.book.slug}" />
	<meta property="og:image" content="{page.url.origin}/api/og/completed-{data.book.slug}" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="I just finished {data.book.title} — In Plain English" />
	<meta name="twitter:description" content="You just read all of {data.book.title} in plain English." />
	<meta name="twitter:image" content="/api/og/completed-{data.book.slug}" />
</svelte:head>

<div class="completion-page">
	<section class="celebration">
		<p class="author-label" style="color: {accentVar[data.author.slug]}">{data.author.title} — {data.author.name}</p>
		<h1>You just read all of {data.book.title}</h1>
		<p class="subtitle">In plain English. Every card.</p>

		<div class="stats">
			<div class="stat">
				<span class="stat-value">{data.book.total_cards}</span>
				<span class="stat-label">cards read</span>
			</div>
			<div class="stat">
				<span class="stat-value">~{readingMinutes}</span>
				<span class="stat-label">minutes of reading</span>
			</div>
		</div>
	</section>

	<div class="share-row">
		<button type="button" class="share-button" onclick={shareCompletion} aria-label="Share that you finished this book">
			Share
		</button>
		{#if shareConfirm}
			<span class="share-confirm" aria-live="polite">{shareConfirm}</span>
		{/if}
	</div>

	<p class="support-line">
		If Plain helped you finish this, you can <a href="/support">support the project</a>.
	</p>

	{#if data.suggestion}
		<section class="next-book">
			<h2>What to read next</h2>
			<a href="/{data.suggestion.slug}" class="suggestion-link">
				<span class="suggestion-title">{data.suggestion.title}</span>
				<span class="suggestion-desc">{data.suggestion.description}</span>
			</a>
		</section>
	{/if}

	<a href="/" class="home-link">Back to all books</a>
</div>

<style>
	.completion-page {
		max-width: var(--max-line-width);
		margin: 0 auto;
		padding: var(--space-3xl) var(--space-md);
		text-align: center;
	}

	.celebration {
		margin-bottom: var(--space-md);
	}

	.author-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-md);
	}

	h1 {
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw + 0.5rem, 2.25rem);
		font-weight: 400;
		line-height: 1.3;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-sm);
	}

	.subtitle {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-xl);
	}

	.stats {
		display: flex;
		justify-content: center;
		gap: var(--space-2xl);
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
	}

	.stat-value {
		font-family: var(--font-body);
		font-size: 1.75rem;
		font-weight: 400;
		color: var(--color-text-primary);
	}

	.stat-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}

	.next-book {
		margin-bottom: var(--space-2xl);
	}

	.next-book h2 {
		font-family: var(--font-body);
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-md);
	}

	.suggestion-link {
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		padding: var(--space-lg);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		text-decoration: none;
		max-width: 400px;
		margin: 0 auto;
		transition: border-color var(--transition-fast);
	}

	.suggestion-link:hover {
		border-color: var(--color-text-secondary);
	}

	.suggestion-title {
		font-family: var(--font-body);
		font-size: 1.125rem;
		color: var(--color-text-primary);
	}

	.suggestion-desc {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.share-row {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--space-md);
		margin: 0 0 var(--space-md);
	}

	.share-button {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-primary);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: var(--space-sm) var(--space-lg);
		cursor: pointer;
		transition: border-color var(--transition-fast);
	}

	.share-button:hover {
		border-color: var(--color-text-secondary);
	}

	.share-confirm {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}

	.support-line {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-3xl);
	}

	.support-line a {
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.support-line a:hover {
		color: var(--color-text-primary);
	}

	.home-link {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.home-link:hover {
		color: var(--color-text-primary);
	}
</style>
