<script>
	import { BMC_URL, SPLIT_ATOM_LABS_URL } from '$lib/config.js';
</script>

<svelte:head>
	<title>Support — Plain</title>
	<meta name="description" content="Plain is free and always will be. If it has helped you, you can support the project." />
</svelte:head>

<div class="static-page">
	<h1>Support</h1>

	<p>In a world of constant noise, wisdom from the people who came before us matters more than ever. Plain exists to make ancient wisdom readable again, in plain English, for everyone. It starts with the Stoics — Epictetus, Marcus Aurelius, Seneca — whose ideas remain strikingly practical for living in a world you can't control.</p>

	<p>It's built by <a href={SPLIT_ATOM_LABS_URL} target="_blank" rel="noopener">Split Atom Labs</a>, a small independent studio. Plain is free. No ads, no paywalls, no premium tier. You can read more about how Plain is made on the <a href="/about">about page</a>.</p>

	<p>If Plain has helped you, and you'd like to help it keep going, you can support Split Atom Labs financially. Any amount, one-time or recurring. No account required.</p>

	<p class="cta-row">
		<a class="cta-primary" href={BMC_URL} target="_blank" rel="noopener">Support on Buy Me a Coffee →</a>
	</p>

	<h2>What your support funds</h2>
	<ul>
		<li><strong>Hosting.</strong> The domain, servers, and infrastructure that keep Plain online.</li>
		<li><strong>New books.</strong> Every book added to Plain goes through an AI-assisted editorial pipeline — parsing the source text, refining it into chunks, translating it into plain English, and assembling it into cards, with verification at every step.</li>
	</ul>

	<h2>What your support does not buy</h2>
	<ul>
		<li>Early access to new books</li>
		<li>Premium features</li>
		<li>Your name anywhere in the product</li>
		<li>Influence over what gets translated next</li>
	</ul>

	<p>Plain treats every reader the same, whether they've contributed financially or not. Democratizing knowledge is the whole point.</p>

	<h2>Other ways to help</h2>

	<p>Money isn't the only way to support Plain. If financial support isn't an option, you can:</p>

	<ul>
		<li><strong>Share a card with someone.</strong> Plain is built around giving, not extracting. Sharing a card with a friend is the kind of distribution the project was designed for.</li>
		<li><strong>Share what you think.</strong> I'm genuinely curious how Plain lands with readers and where the experience could be better. <a href={SPLIT_ATOM_LABS_URL} target="_blank" rel="noopener">Contact details on the Split Atom Labs site.</a></li>
	</ul>

	<p>Thank you for reading.</p>
</div>

<style>
	.static-page {
		max-width: var(--max-line-width);
		margin: 0 auto;
		padding: var(--space-3xl) var(--space-md);
	}

	@media (max-width: 600px) {
		.static-page {
			padding: var(--space-sm) var(--space-md) var(--space-xl);
		}
	}

	h1 {
		font-family: var(--font-body);
		font-size: clamp(1.5rem, 3vw + 0.5rem, 2.25rem);
		font-weight: 400;
		line-height: 1.3;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-xl);
	}

	h2 {
		font-family: var(--font-body);
		font-size: 1.5rem;
		font-weight: 500;
		line-height: 1.3;
		color: var(--color-text-primary);
		margin: var(--space-3xl) 0 var(--space-md);
	}

	p,
	li {
		font-family: var(--font-body);
		font-size: 1.0625rem;
		line-height: 1.65;
		color: var(--color-text-primary);
		margin: 0 0 var(--space-md);
	}

	ul {
		padding-left: var(--space-lg);
		margin: 0 0 var(--space-md);
	}

	li {
		margin-bottom: var(--space-sm);
	}

	a {
		color: var(--color-text-primary);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}

	.cta-row {
		margin: var(--space-xl) 0 var(--space-2xl);
	}

	.cta-row :global(.cta-primary) {
		text-decoration: none;
	}
</style>
