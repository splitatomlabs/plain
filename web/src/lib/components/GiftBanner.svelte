<script>
	let { note = '', bookTitle = '', authorName = '', bookSlug = '', firstCardUrl = '' } = $props();

	const decodedNote = (() => {
		try {
			// Reverse URL-safe base64: - → +, _ → /, add padding
			let b64 = note.replace(/-/g, '+').replace(/_/g, '/');
			while (b64.length % 4) b64 += '=';
			return atob(b64);
		} catch {
			return '';
		}
	})();
</script>

{#if decodedNote}
	<div class="gift-banner" role="complementary" aria-label="Gift message">
		<p class="gift-note">"{decodedNote}"</p>
		<p class="gift-context">Someone sent you <strong>{bookTitle}</strong> by {authorName}.</p>
		<a href={firstCardUrl} class="gift-cta">Start reading</a>
	</div>
{/if}

<style>
	.gift-banner {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: var(--space-lg);
		margin-bottom: var(--space-xl);
		text-align: center;
	}

	.gift-note {
		font-family: var(--font-body);
		font-size: 1.125rem;
		font-style: italic;
		color: var(--color-text-primary);
		line-height: var(--line-height-body);
		margin: 0 0 var(--space-md);
		max-width: var(--max-line-width);
		margin-left: auto;
		margin-right: auto;
	}

	.gift-context {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-md);
	}

	.gift-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-sm) var(--space-xl);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		color: var(--color-surface);
		background: var(--color-text-primary);
		border: none;
		border-radius: 6px;
		text-decoration: none;
		transition: opacity var(--transition-fast);
	}

	.gift-cta:hover {
		opacity: 0.85;
	}
</style>
