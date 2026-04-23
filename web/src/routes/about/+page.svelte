<script>
	import { SPLIT_ATOM_LABS_URL } from '$lib/config.js';
</script>

<svelte:head>
	<title>About — Plain</title>
	<meta name="description" content="Plain turns classic works of ancient philosophy into short cards written in plain English." />
</svelte:head>

<div class="static-page">
	<h1>About</h1>

	<p>Plain turns classic works of ancient philosophy into short cards written in plain English, so you can actually read them, finish them, and take something from them. It starts with the Stoics — Epictetus, Marcus Aurelius, Seneca — whose ideas remain strikingly practical for living in a world you can't control.</p>

	<p>It's built by <a href={SPLIT_ATOM_LABS_URL} target="_blank" rel="noopener">Split Atom Labs</a>, a small independent studio run by my co-founder and me. I'm Aaron, and Plain is my passion project. I do the editorial work, build the pipeline, and shape the reading experience. Plain is free to read and has no ads, paywalls, or premium tiers. It exists because these books deserve to be read.</p>

	<h2>The problem Plain tries to solve</h2>

	<p>We're living through a time of rapid change, constant noise, and more information than anyone can process. In that environment, wisdom from people who lived thousands of years ago becomes more valuable, not less. The Stoics faced plagues, political collapse, exile, loss, and the basic problem of how to live a good life in a world you don't control. They had answers. Those answers still work. But the books they're written in have become fortresses guarded by archaic language and unfamiliar references. These ideas were meant for everyone, and they're needed now more than ever.</p>

	<p>If you've ever picked up Marcus Aurelius, Epictetus, or Seneca and put it down twenty pages in, you're not alone. The ideas in these books are some of the most useful ever written. But the English translations most people read are 100+ years old, dense with Victorian phrasing, and full of names and references that meant something in Rome and mean nothing now.</p>

	<p>The philosophy isn't the problem. The language is.</p>

	<p>Plain strips that language away. Every card contains one idea, translated into plain modern English at roughly an 8th-grade reading level. The original text is always one tap away if you want to check the translation, see the formal language, or read it the old way.</p>

	<h2 id="how-translations-are-made">How the translations are made</h2>

	<p>Plain's translations are produced through an editorial pipeline that combines AI with human oversight. Here is exactly what happens for every book:</p>

	<ol>
		<li><strong>Source text.</strong> I start with a public domain English translation of the original, typically from Project Gutenberg. These are the translations Plain is working <em>from</em>, not <em>replacing</em>. The original text shown in the app is this source translation.</li>
		<li><strong>Chunk and refine.</strong> The Stoics didn't write in chapters the way modern books do, so the first job is deciding where one thought ends and another begins. I use AI to produce an initial chunking and then refine it against explicit guidelines about what constitutes a complete idea. The chunking rules are customized for each book — Epictetus is terse and list-like, Marcus Aurelius writes fragmentary private journal entries, Seneca writes long flowing letters. Each requires different rules for where to draw the boundaries.</li>
		<li><strong>Plain English translation.</strong> I use AI to produce plain English versions of each chunk. AI is good at this particular task, it can handle dense ancient prose and produce clear modern English quickly. Instructions are specific to each book: tone, reading level, voice, what to preserve, what to simplify. The quality of these instructions is where most of the editorial judgment happens.</li>
		<li><strong>Verification at every step.</strong> Rather than checking quality only at the end, the pipeline verifies at every stage: parsing, refining, translating, assembling. Multiple agents cross-examine each other's work, with each pass checking something different. Cards that fail verification get regenerated with adjusted instructions or flagged for closer attention.</li>
		<li><strong>Iterative validation.</strong> Rather than proofreading every card by hand, I validate that the pipeline is producing output that stays true to Plain's principles. For each book, I run the pipeline, read through samples, check the verification outputs, and refine the prompts and rules. This loop continues until the book is consistently producing cards that hit the right tone, reading level, and accuracy. The goal is a system I trust, not a stack of individually proofread cards.</li>
	</ol>

	<h2>What this means in practice</h2>

	<p>Plain's translations are not "AI-generated" in the dismissive sense — where an AI produces text and nobody checks whether it's any good. The pipeline is designed, tuned, and validated by a human. Verification runs at every step. Reader feedback shapes how it evolves.</p>

	<p>But Plain is only possible because of AI. Translating these books into plain English alone, by hand, would take years. With AI doing the heavy lifting and me building and validating the system that ensures it works, it takes weeks. Without AI, this project would not exist.</p>

	<h2>The source translations</h2>

	<p>Every book in Plain links to its source text, typically from Project Gutenberg. You can find the specific translation, translator, and link on each book's page in the app.</p>

	<h2>Why plain English matters</h2>

	<p>The Stoics wrote for ordinary people trying to live better lives. Epictetus was a slave teaching other slaves and freedmen. Marcus Aurelius wrote privately, for himself, not for publication. Seneca wrote letters to a friend.</p>

	<p>None of them wrote for scholars. None of them wrote in the kind of formal, distant English their books are usually rendered in today.</p>

	<p>Making things easier to engage with is a consistent thread across Split Atom Labs' work. A previous project, the mobile game <a href="https://landoflivia.com">Land of Livia</a>, was designed around accessibility and as 2025 Apple Design Award Finalist for Inclusivity. Plain extends the same instinct to reading.</p>

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

	ol {
		padding-left: var(--space-lg);
		margin: 0 0 var(--space-md);
	}

	li {
		margin-bottom: var(--space-md);
	}

	a {
		color: var(--color-text-primary);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
</style>
