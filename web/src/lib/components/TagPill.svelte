<a href="/tags/{slug}" class="tag-pill">{label}</a>

<script>
	let { slug, label } = $props();
</script>

<style>
	.tag-pill {
		display: inline-flex;
		align-items: center;
		padding: var(--space-xs) var(--space-sm);
		min-height: 44px;
		min-width: 44px;
		background: var(--color-tag-bg);
		color: var(--color-text-tertiary);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
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
</style>
