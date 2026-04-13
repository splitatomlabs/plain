<script>
	import { trackEvent } from '$lib/analytics.js';

	let { title = '', text = '', url = '', type = 'card', bookId = null } = $props();

	let copied = $state(false);
	let copyTimeout;

	async function handleShare() {
		if (navigator.share) {
			try {
				await navigator.share({ title, text: `${text}\n\n${url}` });
				trackEvent('share_clicked', { type, book_id: bookId });
			} catch (err) {
				// User cancelled or share failed — do not fire event
			}
		} else {
			await copyToClipboard();
		}
	}

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(`${text} ${url}`);
			copied = true;
			clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => {
				copied = false;
			}, 2000);
			trackEvent('share_clicked', { type, book_id: bookId });
		} catch {
			// Clipboard API unavailable
		}
	}
</script>

<button
	class="share-button"
	aria-label="Share this card"
	onclick={handleShare}
>
	{#if copied}
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<polyline points="20 6 9 17 4 12" />
		</svg>
		<span class="share-label">Copied!</span>
	{:else}
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<circle cx="18" cy="5" r="3" />
			<circle cx="6" cy="12" r="3" />
			<circle cx="18" cy="19" r="3" />
			<line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
			<line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
		</svg>
	{/if}
</button>

<style>
	.share-button {
		background: none;
		border: none;
		padding: var(--space-xs);
		cursor: pointer;
		color: var(--color-text-secondary);
		min-width: 44px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-xs);
		border-radius: 50%;
		transition: color var(--transition-fast);
	}

	.share-button:hover {
		color: var(--color-text-primary);
	}

	.share-label {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
	}
</style>
