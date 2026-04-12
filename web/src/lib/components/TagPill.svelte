<a href="/tags/{slug}" class="tag-pill">
	{label}
	{#if progress}<span class="tag-badge">{progress}</span>{/if}
</a>

<script>
	let { slug, label, progress = null } = $props();
</script>

<style>
	.tag-pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-xs);
		padding: var(--space-xs) var(--space-sm);
		min-height: 44px;
		min-width: 44px;
		background: var(--color-tag-bg);
		color: var(--color-text-tertiary);
		font-family: var(--font-ui);
		font-size: clamp(0.6875rem, 0.625rem + 0.125vw, 0.75rem);
		font-weight: 500;
		line-height: var(--line-height-ui);
		text-decoration: none;
		border-radius: 6px;
		transition: background var(--transition-fast), color var(--transition-fast);
	}

	.tag-pill:hover {
		background: var(--color-border);
		color: var(--color-text-primary);
	}

	.tag-badge {
		font-size: 0.625rem;
		font-weight: 400;
		color: var(--color-text-secondary);
		opacity: 0.7;
	}
</style>
