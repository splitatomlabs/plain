<script>
	let { current, total, authorSlug } = $props();

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};

	const color = accentVar[authorSlug] ?? 'var(--color-text-secondary)';
	const percentage = $derived(Math.round((current / total) * 100));
</script>

<div
	class="progress-bar"
	role="progressbar"
	aria-valuenow={current}
	aria-valuemin={0}
	aria-valuemax={total}
	aria-label="Reading progress: {current} of {total} cards"
>
	<div
		class="progress-fill"
		style="width: {percentage}%; background-color: {color}"
	></div>
</div>

<style>
	.progress-bar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--color-border);
		z-index: 50;
	}

	.progress-fill {
		height: 100%;
		transition: width var(--transition-fast);
	}
</style>
