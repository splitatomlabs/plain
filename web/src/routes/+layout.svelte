<script>
	import '@fontsource-variable/literata';
	import '@fontsource-variable/dm-sans';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';

	let { children } = $props();
	let theme = $state(null);

	onMount(() => {
		theme = document.documentElement.getAttribute('data-theme') || 'light';
	});

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		document.documentElement.setAttribute('data-theme', theme);
		try { localStorage.setItem('plain-theme', theme); } catch (e) {}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<a href="#main-content" class="skip-link">Skip to content</a>

<header class="site-header">
	<a href="/" class="site-name">Plain</a>
	{#if theme !== null}
	<button
		class="theme-toggle"
		onclick={toggleTheme}
		aria-label="Toggle {theme === 'light' ? 'dark' : 'light'} mode"
	>
		{#if theme === 'light'}
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
			</svg>
		{:else}
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<circle cx="12" cy="12" r="5"/>
				<line x1="12" y1="1" x2="12" y2="3"/>
				<line x1="12" y1="21" x2="12" y2="23"/>
				<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
				<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
				<line x1="1" y1="12" x2="3" y2="12"/>
				<line x1="21" y1="12" x2="23" y2="12"/>
				<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
				<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
			</svg>
		{/if}
	</button>
	{/if}
</header>

<main id="main-content">
	{@render children()}
</main>

<footer class="site-footer">
	<p>Ancient philosophy, in plain English.</p>
</footer>

<style>
	.skip-link {
		position: absolute;
		left: -9999px;
		top: auto;
		width: 1px;
		height: 1px;
		overflow: hidden;
		padding: var(--space-sm) var(--space-md);
		background: var(--color-surface);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		border: 1px solid var(--color-border);
		z-index: 100;
	}

	.skip-link:focus {
		left: var(--space-md);
		top: var(--space-sm);
		width: auto;
		height: auto;
		overflow: visible;
	}

	.site-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-md) var(--space-lg);
		max-width: 72rem;
		margin: 0 auto;
	}

	.site-name {
		font-family: var(--font-body);
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text-primary);
		text-decoration: none;
	}

	.theme-toggle {
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

	.theme-toggle:hover {
		border-color: var(--color-text-secondary);
		color: var(--color-text-primary);
	}

	main {
		max-width: 72rem;
		margin: 0 auto;
		padding: 0 var(--space-lg);
	}

	.site-footer {
		max-width: 72rem;
		margin: var(--space-3xl) auto 0;
		padding: var(--space-lg);
		text-align: center;
		font-family: var(--font-ui);
		font-size: var(--text-ui);
		color: var(--color-text-secondary);
	}
</style>
