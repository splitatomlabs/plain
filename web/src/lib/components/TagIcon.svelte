<script>
	const ICONS = {
		'calm-your-mind': {
			// Still water ripple
			paths: [
				'M8 16 Q16 12 24 16 Q32 20 40 16',
				'M6 24 Q16 20 26 24 Q36 28 42 24',
				'M10 32 Q18 28 26 32 Q34 36 38 32'
			]
		},
		'death-and-mortality': {
			// Hourglass
			paths: [
				'M12 8 H36',
				'M12 40 H36',
				'M14 8 L24 22 L34 8',
				'M14 40 L24 26 L34 40'
			]
		},
		'doing-the-right-thing': {
			// Scales of justice
			paths: [
				'M24 6 V38',
				'M16 38 H32',
				'M10 14 H38',
				'M10 14 L6 26 Q10 30 14 26 Z',
				'M38 14 L34 26 Q38 30 42 26 Z'
			]
		},
		'facing-hardship': {
			// Mountain peak
			paths: [
				'M4 38 L18 12 L26 22 L34 10 L44 38 Z'
			]
		},
		'freedom-and-control': {
			// Bird in flight — spread wings
			paths: [
				'M4 18 Q12 8 24 16 Q36 8 44 18',
				'M24 16 Q24 28 20 36',
				'M24 16 Q24 28 28 36'
			]
		},
		'human-nature': {
			// Two figures with space between
			paths: [
				'M13 14 A4 4 0 1 1 13.01 14',
				'M35 14 A4 4 0 1 1 35.01 14',
				'M7 38 Q7 22 13 20 Q18 18 22 24',
				'M41 38 Q41 22 35 20 Q30 18 26 24'
			]
		},
		'knowing-yourself': {
			// Mirror / reflection
			paths: [
				'M24 6 A14 14 0 1 1 24 34',
				'M24 6 A14 14 0 1 0 24 34',
				'M24 34 V42',
				'M18 42 H30',
				'M20 16 A4 3 0 0 1 28 16'
			]
		},
		'what-matters-most': {
			// Compass star
			paths: [
				'M24 4 L28 20 L44 24 L28 28 L24 44 L20 28 L4 24 L20 20 Z'
			]
		}
	};

	const MILESTONE_COLORS = {
		10: { fill: '#CD7F32', label: 'Bronze' },   // Bronze
		25: { fill: '#A8A9AD', label: 'Silver' },   // Silver
		50: { fill: '#CFB53B', label: 'Gold' },     // Gold
		100: { fill: '#E5E4E2', label: 'Platinum' } // Platinum
	};

	let { slug, label, cardsRead = 0, milestone = null } = $props();

	const icon = $derived(ICONS[slug]);
	const badge = $derived(milestone ? MILESTONE_COLORS[milestone] : null);
</script>

<a href="/tags/{slug}" class="tag-icon" aria-label="{label} — {cardsRead} cards read">
	<div class="icon-wrapper">
		<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon-svg">
			{#if icon}
				{#each icon.paths as d}
					<path {d} />
				{/each}
			{/if}
		</svg>
		{#if badge}
			<svg class="milestone-badge" viewBox="0 0 12 12" aria-hidden="true" title="{badge.label} — {cardsRead} cards read">
				<path d="M6 0 L12 6 L6 12 L0 6 Z" fill="{badge.fill}" />
			</svg>
		{/if}
	</div>
	<span class="icon-label">{label}</span>
	{#if cardsRead > 0}
		<span class="icon-count">{cardsRead} read</span>
	{/if}
</a>

<style>
	.tag-icon {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-xs);
		text-decoration: none;
		width: 5.5rem;
		padding: var(--space-sm) var(--space-xs);
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		transition: border-color var(--transition-fast);
	}

	.tag-icon:hover {
		border-color: var(--color-text-secondary);
	}

	.icon-wrapper {
		position: relative;
		width: 3rem;
		height: 3rem;
	}

	.icon-svg {
		width: 100%;
		height: 100%;
		color: var(--color-text-secondary);
		transition: color var(--transition-fast);
	}

	.tag-icon:hover .icon-svg {
		color: var(--color-text-primary);
	}

	.milestone-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		width: 14px;
		height: 14px;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.15));
	}

	.icon-label {
		font-family: var(--font-ui);
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-align: center;
		line-height: 1.2;
	}

	.icon-count {
		font-family: var(--font-ui);
		font-size: 0.5625rem;
		color: var(--color-text-secondary);
		opacity: 0.7;
	}
</style>
