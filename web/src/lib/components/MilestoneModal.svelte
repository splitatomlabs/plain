<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';

	let { milestone, bookTitle, bookSlug, onClose } = $props();

	const MILESTONES_KEY = 'plain-milestones';

	let dialogRef;
	let triggerElement;

	const messages = {
		25: () => `Quarter of the way through ${bookTitle}`,
		50: () => `Halfway through ${bookTitle}`,
		75: () => `Almost there`,
		100: () => `You've finished ${bookTitle}`
	};

	function hasShownMilestone(bookSlug, milestone) {
		if (!browser) return true;
		try {
			const shown = JSON.parse(localStorage.getItem(MILESTONES_KEY) || '{}');
			return shown[bookSlug]?.includes(milestone);
		} catch {
			return false;
		}
	}

	function recordMilestone(bookSlug, milestone) {
		if (!browser) return;
		try {
			const shown = JSON.parse(localStorage.getItem(MILESTONES_KEY) || '{}');
			if (!shown[bookSlug]) shown[bookSlug] = [];
			if (!shown[bookSlug].includes(milestone)) {
				shown[bookSlug].push(milestone);
			}
			localStorage.setItem(MILESTONES_KEY, JSON.stringify(shown));
		} catch {
			// localStorage unavailable
		}
	}

	export function shouldShow(bookSlug, milestonePercent) {
		return !hasShownMilestone(bookSlug, milestonePercent);
	}

	function close() {
		onClose?.();
		triggerElement?.focus();
	}

	function handleKeydown(e) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
		if (e.key === 'Tab') {
			trapFocus(e);
		}
	}

	function trapFocus(e) {
		if (!dialogRef) return;
		const focusable = dialogRef.querySelectorAll(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	function handleAction() {
		if (milestone === 100) {
			goto(`/completed/${bookSlug}`);
		}
		close();
	}

	onMount(() => {
		triggerElement = document.activeElement;
		recordMilestone(bookSlug, milestone);
		dialogRef?.querySelector('button')?.focus();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="modal-backdrop" onclick={close} onkeydown={handleKeydown} role="presentation">
	<div
		bind:this={dialogRef}
		class="modal"
		role="dialog"
		aria-labelledby="milestone-heading"
		aria-modal="true"
		onclick={(e) => e.stopPropagation()}
		onkeydown={handleKeydown}
	>
		<h2 id="milestone-heading" class="modal-heading">
			{messages[milestone]?.() || ''}
		</h2>
		<p class="modal-detail">{milestone}% complete</p>
		<button class="modal-button" onclick={handleAction}>
			{milestone === 100 ? 'See your achievement' : 'Keep reading'}
		</button>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		animation: fade-in var(--transition-fast) ease-out;
	}

	@media (prefers-reduced-motion: reduce) {
		.modal-backdrop {
			animation: none;
		}

		.modal {
			animation: none;
		}
	}

	@keyframes fade-in {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: var(--space-2xl) var(--space-xl);
		max-width: 400px;
		width: 90%;
		text-align: center;
		animation: slide-up var(--transition-normal) ease-out;
	}

	@keyframes slide-up {
		from { transform: translateY(16px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}

	.modal-heading {
		font-family: var(--font-body);
		font-size: 1.5rem;
		line-height: 1.3;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-sm);
	}

	.modal-detail {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-lg);
	}

	.modal-button {
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		font-weight: 500;
		color: var(--color-surface);
		background: var(--color-text-primary);
		border: none;
		border-radius: 6px;
		padding: var(--space-sm) var(--space-lg);
		min-height: 44px;
		min-width: 44px;
		cursor: pointer;
		transition: opacity var(--transition-fast);
	}

	.modal-button:hover {
		opacity: 0.85;
	}
</style>
