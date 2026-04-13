<script>
	import { page } from '$app/stores';
	import { onDestroy, tick } from 'svelte';

	let open = $state(false);
	let triggerEl;
	let drawerEl;
	let firstLinkEl;
	let lastPath = $state('');

	$effect(() => {
		const path = $page.url.pathname;
		if (lastPath && path !== lastPath && open) {
			open = false;
		}
		lastPath = path;
	});

	$effect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
			tick().then(() => firstLinkEl?.focus());
		} else {
			document.body.style.overflow = '';
		}
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') document.body.style.overflow = '';
	});

	function openMenu() {
		open = true;
	}

	function closeMenu() {
		open = false;
		tick().then(() => triggerEl?.focus());
	}

	function onKeyDown(e) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			closeMenu();
			return;
		}
		if (e.key === 'Tab') {
			const focusables = drawerEl?.querySelectorAll('a, button');
			if (!focusables || focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	function onBackdropClick() {
		closeMenu();
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<button
	bind:this={triggerEl}
	type="button"
	class="menu-trigger"
	aria-label={open ? 'Close menu' : 'Open menu'}
	aria-expanded={open}
	aria-controls="main-menu-drawer"
	onclick={openMenu}
>
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<line x1="3" y1="6" x2="21" y2="6" />
		<line x1="3" y1="12" x2="21" y2="12" />
		<line x1="3" y1="18" x2="21" y2="18" />
	</svg>
</button>

{#if open}
	<div
		class="backdrop"
		onclick={onBackdropClick}
		onkeydown={(e) => e.key === 'Enter' && onBackdropClick()}
		role="button"
		tabindex="-1"
		aria-hidden="true"
	></div>
	<aside
		bind:this={drawerEl}
		id="main-menu-drawer"
		class="drawer"
		role="dialog"
		aria-modal="true"
		aria-label="Main menu"
	>
		<div class="drawer-header">
			<button type="button" class="close-btn" aria-label="Close menu" onclick={closeMenu}>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<line x1="6" y1="6" x2="18" y2="18" />
					<line x1="18" y1="6" x2="6" y2="18" />
				</svg>
			</button>
		</div>
		<nav class="drawer-nav" aria-label="Main">
			<a bind:this={firstLinkEl} href="/">Home</a>
			<a href="/about">About</a>
			<a href="/support">Support</a>
		</nav>
	</aside>
{/if}

<style>
	.menu-trigger {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: border-color var(--transition-fast), color var(--transition-fast);
	}

	.menu-trigger:hover {
		border-color: var(--color-text-secondary);
		color: var(--color-text-primary);
	}

	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 90;
		animation: fade-in 180ms ease-out;
	}

	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(20rem, 85vw);
		background: var(--color-surface);
		border-left: 1px solid var(--color-border);
		z-index: 100;
		display: flex;
		flex-direction: column;
		padding: var(--space-md);
		animation: slide-in 220ms ease-out;
	}

	.drawer-header {
		display: flex;
		justify-content: flex-end;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		background: none;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.close-btn:hover {
		color: var(--color-text-primary);
		border-color: var(--color-text-secondary);
	}

	.drawer-nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-md);
		margin-top: var(--space-xl);
	}

	.drawer-nav a {
		font-family: var(--font-body);
		font-size: 1.25rem;
		color: var(--color-text-primary);
		text-decoration: none;
		padding: var(--space-sm) var(--space-xs);
	}

	.drawer-nav a:hover {
		color: var(--color-text-secondary);
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slide-in {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}
</style>
