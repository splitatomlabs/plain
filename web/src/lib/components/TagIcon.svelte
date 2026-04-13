<script>
	const ICONS = {
		'calm-your-mind': {
			paths: [
				'M8 16 Q16 12 24 16 Q32 20 40 16',
				'M6 24 Q16 20 26 24 Q36 28 42 24',
				'M10 32 Q18 28 26 32 Q34 36 38 32'
			]
		},
		'death-and-mortality': {
			paths: [
				'M12 8 H36',
				'M12 40 H36',
				'M14 8 L24 22 L34 8',
				'M14 40 L24 26 L34 40'
			]
		},
		'doing-the-right-thing': {
			paths: [
				'M24 6 V38',
				'M16 38 H32',
				'M10 14 H38',
				'M10 14 L6 26 Q10 30 14 26 Z',
				'M38 14 L34 26 Q38 30 42 26 Z'
			]
		},
		'facing-hardship': {
			paths: [
				'M4 38 L18 12 L26 22 L34 10 L44 38 Z'
			]
		},
		'freedom-and-control': {
			paths: [
				'M20 24 A6 6 0 1 0 8 24 A6 6 0 1 0 20 24',
				'M20 24 L42 24',
				'M38 24 L38 31',
				'M33 24 L33 31'
			]
		},
		'human-nature': {
			paths: [
				'M13 14 A4 4 0 1 1 13.01 14',
				'M35 14 A4 4 0 1 1 35.01 14',
				'M7 38 Q7 22 13 20 Q18 18 22 24',
				'M41 38 Q41 22 35 20 Q30 18 26 24'
			]
		},
		'knowing-yourself': {
			paths: [
				'M24 6 A14 14 0 1 1 24 34',
				'M24 6 A14 14 0 1 0 24 34',
				'M24 34 V42',
				'M18 42 H30',
				'M20 16 A4 3 0 0 1 28 16'
			]
		},
		'what-matters-most': {
			paths: [
				'M24 4 L28 20 L44 24 L28 28 L24 44 L20 28 L4 24 L20 20 Z'
			]
		}
	};

	const MILESTONES = [10, 25, 50, 100];

	let { slug, label, cardsRead = 0, milestone = null } = $props();

	const icon = $derived(ICONS[slug]);
	const nextMilestone = $derived(MILESTONES.find((m) => cardsRead < m) ?? null);
	const countDisplay = $derived(
		nextMilestone ? `${cardsRead} / ${nextMilestone}` : `${cardsRead} read`
	);
</script>

<a
	href="/tags/{slug}"
	class="tag-icon"
	class:has-milestone={milestone}
	aria-label="{label}{cardsRead ? ` — ${cardsRead} cards read` : ''}"
>
	<div class="icon-wrapper">
		<svg
			viewBox="0 0 48 48"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			class="icon-svg"
		>
			{#if icon}
				{#each icon.paths as d}
					<path {d} />
				{/each}
			{/if}
		</svg>
	</div>
	<span class="icon-label">{label}</span>
	{#if cardsRead > 0}
		<span class="icon-count">{countDisplay}</span>
	{/if}
</a>

<style>
	/*
	 * Mobile layout notes:
	 * - width 6.25rem (100px) is chosen so 3 cards + 16px gaps fit in iPhone 17 (402pt)
	 *   but don't fit in iPhone 15 (390pt) — forces 3-up at 402, 2-up below
	 * - padding is intentionally tight horizontally to allow that width while keeping
	 *   labels from touching the border
	 * - icon-wrapper 3.6rem ≈ 57% of the card width — enough visual weight without
	 *   crowding the label
	 */
	.tag-icon {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-xs);
		text-decoration: none;
		width: 6.25rem;
		padding: 0.625rem 0.375rem;
		border-radius: 12px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		transition: border-color var(--transition-fast);
	}

	.tag-icon:hover {
		border-color: var(--color-text-secondary);
	}

	.icon-wrapper {
		width: 3.6rem;
		height: 3.6rem;
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

	.icon-label {
		font-family: var(--font-ui);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-align: center;
		line-height: 1.2;
	}

	.icon-count {
		font-family: var(--font-ui);
		font-size: 0.6875rem;
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/*
	 * Tablet/desktop (≥768px):
	 * - width: auto lets cards stretch to fill grid columns (set on .themes-icon-grid)
	 * - larger icon + bumped font sizes give more visual weight at desktop proportions
	 * - count font (0.8125rem) is intentionally slightly smaller than label (0.875rem)
	 *   so the read count reads as subordinate metadata, not a headline
	 */
	@media (min-width: 768px) {
		.tag-icon {
			width: auto;
			padding: var(--space-md) var(--space-sm);
			gap: var(--space-sm);
		}

		.icon-wrapper {
			width: 4rem;
			height: 4rem;
		}

		.icon-label {
			font-size: 0.875rem;
		}

		.icon-count {
			font-size: 0.75rem;
		}
	}
</style>
