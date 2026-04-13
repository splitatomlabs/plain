<script>
	let { note = '', bookTitle = '', authorName = '' } = $props();


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
	</div>
{/if}

<style>
	.gift-banner {
		padding: var(--space-lg) 0;
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
		margin: 0;
	}
</style>
