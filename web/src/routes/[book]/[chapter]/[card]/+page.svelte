<script>
	import Card from '$lib/components/Card.svelte';
	import CardNav from '$lib/components/CardNav.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.book.title}, {data.card.source_reference} — In Plain English</title>
	<meta name="description" content={data.card.plain_english.slice(0, 155)} />

	<meta property="og:title" content="{data.book.title}, {data.card.source_reference} — In Plain English" />
	<meta property="og:description" content={data.card.plain_english.slice(0, 155)} />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://plainenglish.app/{data.card.book_slug}/{data.card.chapter_slug}/{data.card.card_number}" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{data.book.title}, {data.card.source_reference} — In Plain English" />
	<meta name="twitter:description" content={data.card.plain_english.slice(0, 155)} />
</svelte:head>

<ProgressBar
	current={data.cardIndex}
	total={data.totalCards}
	authorSlug={data.book.author_slug}
/>

<div class="card-page">
	<CardNav prevCard={data.prevCard} nextCard={data.nextCard}>
		<Card card={data.card} book={data.book} totalCardsInBook={data.totalCards} />
	</CardNav>
</div>

<style>
	.card-page {
		padding: var(--space-xl) 0;
	}
</style>
