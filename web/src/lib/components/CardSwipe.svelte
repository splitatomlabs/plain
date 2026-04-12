<script>
	import { onMount } from 'svelte';

	let { children, nextCardSnippet, onDismiss, onPromoteStart, hasNext = false, canSwipe = true, cardId = '' } = $props();

	let containerEl = $state(null);
	let dragging = $state(false);
	let thrown = $state(false);
	let promoting = $state(false);
	let dx = $state(0);
	let dy = $state(0);

	// Velocity tracking — last 4 pointer positions
	let velocityBuffer = [];
	let startX = 0;
	let startY = 0;
	let throwFallbackTimer = null;

	// Reset drag state when the active card changes (after navigation)
	$effect(() => {
		cardId;
		thrown = false;
		promoting = false;
		dragging = false;
		dx = 0;
		dy = 0;
		clearTimeout(throwFallbackTimer);
	});

	// Drag progress for next-card scale (0 to 1)
	const dragProgress = $derived.by(() => {
		if (!containerEl) return 0;
		const maxDist = containerEl.clientWidth * 0.3;
		return Math.min(Math.sqrt(dx * dx + dy * dy) / maxDist, 1);
	});

	// Rotation based on horizontal offset (max ±6°)
	const rotation = $derived(Math.max(-6, Math.min(6, dx * 0.04)));

	// Shadow intensity proportional to drag distance
	const shadowOpacity = $derived(dragProgress * 0.12);

	// Next card scale
	const nextScale = $derived(0.97 + dragProgress * 0.03);

	// Reduced motion check
	let reducedMotion = $state(false);
	onMount(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mq.matches;
		const handler = (e) => { reducedMotion = e.matches; };
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	});

	function handlePointerDown(e) {
		if (thrown || promoting) return;
		if (e.button !== 0) return;
		if (e.target.closest('button, a, [role="button"], summary')) return;

		dragging = true;
		dx = 0;
		dy = 0;
		startX = e.clientX;
		startY = e.clientY;
		velocityBuffer = [{ x: e.clientX, y: e.clientY, t: performance.now() }];

		containerEl.setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e) {
		if (!dragging || thrown || promoting) return;

		if (!reducedMotion) {
			dx = e.clientX - startX;
			dy = e.clientY - startY;
		}

		velocityBuffer.push({ x: e.clientX, y: e.clientY, t: performance.now() });
		if (velocityBuffer.length > 4) velocityBuffer.shift();
	}

	function handlePointerUp(e) {
		if (!dragging || thrown || promoting) return;
		dragging = false;

		let velocity = 0;
		if (velocityBuffer.length >= 2) {
			const last = velocityBuffer[velocityBuffer.length - 1];
			const prev = velocityBuffer[velocityBuffer.length - 2];
			const dt = last.t - prev.t;
			if (dt > 0) {
				const ddx = last.x - prev.x;
				const ddy = last.y - prev.y;
				velocity = Math.sqrt(ddx * ddx + ddy * ddy) / dt;
			}
		}

		const last = velocityBuffer[velocityBuffer.length - 1] || { x: startX, y: startY };
		const totalDx = last.x - startX;
		const totalDy = last.y - startY;
		const offset = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
		const viewportWidth = containerEl.clientWidth;
		const shouldDismiss = canSwipe && hasNext && (velocity > 0.5 || offset > viewportWidth * 0.3);

		if (shouldDismiss) {
			if (reducedMotion) {
				dx = 0;
				dy = 0;
				onPromoteStart?.();
				onDismiss?.();
			} else {
				thrown = true;
				const angle = Math.atan2(dy, dx);
				const throwDist = Math.max(viewportWidth * 1.5, 800);
				dx = Math.cos(angle) * throwDist;
				dy = Math.sin(angle) * throwDist;
				throwFallbackTimer = setTimeout(() => {
					if (thrown && !promoting) {
						handleThrowEnd({ propertyName: 'transform' });
					}
				}, 300);
			}
		} else {
			dx = 0;
			dy = 0;
		}
	}

	function handlePointerCancel() {
		// Browser took over for native scroll — reset cleanly
		dragging = false;
		dx = 0;
		dy = 0;
	}

	function handleThrowEnd(e) {
		if (thrown && !promoting && e.propertyName === 'transform') {
			clearTimeout(throwFallbackTimer);
			promoting = true;
			onPromoteStart?.();
			if (nextScale >= 0.999) {
				onDismiss?.();
			}
		}
	}

	function handlePromoteEnd(e) {
		if (promoting && e.propertyName === 'transform') {
			onDismiss?.();
		}
	}
</script>

<div
	class="card-swipe"
	bind:this={containerEl}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
	style="touch-action: pan-y;"
	role="presentation"
>
	<!-- Next card (underneath) -->
	{#if nextCardSnippet}
		<div
			class="card-swipe-layer card-swipe-next"
			class:promoting
			style={promoting ? '' : `transform: scale(${nextScale})`}
			ontransitionend={handlePromoteEnd}
		>
			{@render nextCardSnippet()}
		</div>
	{/if}

	<!-- Current card (on top) -->
	<div
		class="card-swipe-layer card-swipe-current"
		class:dragging
		class:thrown
		class:hidden-thrown={promoting}
		style="
			transform: translate({dx}px, {dy}px) rotate({dragging || thrown ? rotation : 0}deg);
			box-shadow: 0 {8 * shadowOpacity / 0.12}px {24 * shadowOpacity / 0.12}px rgba(0,0,0,{shadowOpacity});
		"
		ontransitionend={handleThrowEnd}
	>
		{@render children()}
	</div>
</div>

<style>
	.card-swipe {
		position: relative;
		max-width: var(--max-line-width);
		margin: 0 auto;
		cursor: grab;
		-webkit-user-select: none;
		user-select: none;
	}

	.card-swipe :global(*) {
		-webkit-user-select: none;
		user-select: none;
	}

	.card-swipe:active {
		cursor: grabbing;
	}

	.card-swipe-layer {
		width: 100%;
	}

	.card-swipe-next {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
		transform-origin: center center;
		pointer-events: none;
	}

	.card-swipe-next.promoting {
		transform: scale(1);
		opacity: 1;
		transition: transform var(--transition-promote), opacity var(--transition-promote);
	}

	.card-swipe-current {
		position: relative;
		z-index: 1;
		will-change: transform;
	}

	.card-swipe-current.hidden-thrown {
		display: none;
	}

	.card-swipe-current.thrown {
		transition: transform var(--transition-throw);
	}

	/* During drag, no transition (direct manipulation) */
	.card-swipe-current.dragging {
		transition: none;
	}

	/* Snap-back transition when not dragging and not thrown */
	.card-swipe-current:not(.dragging):not(.thrown) {
		transition: transform var(--transition-normal), box-shadow var(--transition-normal);
	}

	@media (prefers-reduced-motion: reduce) {
		.card-swipe {
			cursor: default;
		}

		.card-swipe-current {
			transition: none !important;
		}
	}
</style>
