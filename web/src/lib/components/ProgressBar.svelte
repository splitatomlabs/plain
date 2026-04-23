<script>
	let { current, total, authorSlug, chapters = null, hasChapters = false } = $props();

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};

	const color = $derived(accentVar[authorSlug] ?? 'var(--color-text-secondary)');
	const percentage = $derived(Math.round((current / total) * 100));

	// Calculate tick positions for chapter boundaries (cumulative percentages)
	const ticks = $derived.by(() => {
		if (!hasChapters || !chapters || chapters.length <= 1) return [];
		const positions = [];
		let cumulative = 0;
		for (let i = 0; i < chapters.length - 1; i++) {
			cumulative += chapters[i].card_count;
			positions.push(Math.round((cumulative / total) * 100));
		}
		return positions;
	});

	// Current chapter info (for SR announcement of section position)
	const currentChapter = $derived.by(() => {
		if (!hasChapters || !chapters || chapters.length === 0) return null;
		let cumulative = 0;
		for (let i = 0; i < chapters.length; i++) {
			const nextCumulative = cumulative + chapters[i].card_count;
			if (current <= nextCumulative) {
				const inChapter = Math.max(0, current - cumulative);
				const count = chapters[i].card_count;
				return {
					title: chapters[i].title,
					percentInChapter: count > 0 ? Math.round((inChapter / count) * 100) : 0
				};
			}
			cumulative = nextCumulative;
		}
		return null;
	});

	const ariaLabel = $derived(
		currentChapter
			? `${currentChapter.title} of ${chapters.length}, ${currentChapter.percentInChapter}% complete`
			: `${percentage}% complete`
	);
</script>

<div
	class="progress-bar"
	role="progressbar"
	aria-label="Reading progress"
	aria-valuenow={percentage}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuetext={ariaLabel}
>
	<div
		class="progress-fill"
		style="width: {percentage}%; background-color: {color}"
	></div>
	{#each ticks as pos}
		<div class="progress-tick" style="left: {pos}%" aria-hidden="true"></div>
	{/each}
</div>

<style>
	.progress-bar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 4px;
		background: var(--color-border);
		z-index: 50;
	}

	.progress-fill {
		height: 100%;
		transition: width var(--transition-fast);
	}

	.progress-tick {
		position: absolute;
		top: 0;
		width: 2px;
		height: 100%;
		background: var(--color-text-secondary);
		opacity: 0.5;
	}
</style>
