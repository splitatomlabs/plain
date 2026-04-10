<script>
	let { percentage = 0, size = 'medium', authorSlug = '', label = '' } = $props();

	const sizes = {
		small: { width: 48, stroke: 4 },
		medium: { width: 80, stroke: 5 }
	};

	const config = $derived(sizes[size] || sizes.medium);
	const radius = $derived((config.width - config.stroke) / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const offset = $derived(circumference - (percentage / 100) * circumference);

	const accentVar = {
		epictetus: 'var(--color-accent-epictetus)',
		'marcus-aurelius': 'var(--color-accent-marcus)',
		seneca: 'var(--color-accent-seneca)'
	};

	const accentColor = $derived(accentVar[authorSlug] || 'var(--color-text-secondary)');
</script>

<svg
	class="progress-ring"
	class:small={size === 'small'}
	class:medium={size === 'medium'}
	width={config.width}
	height={config.width}
	viewBox="0 0 {config.width} {config.width}"
	role="img"
	aria-label={label}
>
	<circle
		class="ring-bg"
		cx={config.width / 2}
		cy={config.width / 2}
		r={radius}
		stroke-width={config.stroke}
		fill="none"
	/>
	<circle
		class="ring-fill"
		cx={config.width / 2}
		cy={config.width / 2}
		r={radius}
		stroke-width={config.stroke}
		fill="none"
		stroke={accentColor}
		stroke-dasharray={circumference}
		stroke-dashoffset={offset}
		stroke-linecap="round"
		transform="rotate(-90 {config.width / 2} {config.width / 2})"
	/>
	<text
		x={config.width / 2}
		y={config.width / 2}
		class="ring-text"
		text-anchor="middle"
		dominant-baseline="central"
	>
		{percentage}%
	</text>
</svg>

<style>
	.progress-ring {
		display: block;
	}

	.ring-bg {
		stroke: var(--color-border);
	}

	.ring-fill {
		transition: stroke-dashoffset var(--transition-slow);
	}

	@media (prefers-reduced-motion: reduce) {
		.ring-fill {
			transition: none;
		}
	}

	.ring-text {
		font-family: var(--font-ui);
		font-weight: 500;
		fill: var(--color-text-primary);
	}

	.small .ring-text {
		font-size: 11px;
	}

	.medium .ring-text {
		font-size: 14px;
	}
</style>
