import { ImageResponse } from '@vercel/og';
import { getAllCards, getBookMeta } from '$lib/utils/content.js';

const ACCENT_COLORS = {
	epictetus: '#B5704F',
	'marcus-aurelius': '#5B6E8A',
	seneca: '#6B7F5E'
};

const AUTHOR_NAMES = {
	epictetus: 'Epictetus',
	'marcus-aurelius': 'Marcus Aurelius',
	seneca: 'Seneca'
};

export async function GET({ params }) {
	const { cardId } = params;

	// Handle completion OG images: "completed-meditations"
	if (cardId.startsWith('completed-')) {
		const bookSlug = cardId.replace('completed-', '');
		let book;
		try {
			book = getBookMeta(bookSlug);
		} catch {
			return new Response('Book not found', { status: 404 });
		}

		const html = {
			type: 'div',
			props: {
				style: {
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					width: '100%',
					height: '100%',
					backgroundColor: '#FAF7F2',
					padding: '60px',
					fontFamily: 'Georgia, serif'
				},
				children: [
					{
						type: 'div',
						props: {
							style: {
								fontSize: '28px',
								color: ACCENT_COLORS[book.author_slug] || '#736B62',
								marginBottom: '20px'
							},
							children: 'Completed'
						}
					},
					{
						type: 'div',
						props: {
							style: {
								fontSize: '48px',
								color: '#2C2520',
								textAlign: 'center',
								lineHeight: '1.3',
								maxWidth: '800px'
							},
							children: book.title
						}
					},
					{
						type: 'div',
						props: {
							style: {
								fontSize: '20px',
								color: '#736B62',
								marginTop: '24px'
							},
							children: `${book.total_cards} cards — In Plain English`
						}
					}
				]
			}
		};

		return new ImageResponse(html, {
			width: 1200,
			height: 630,
			headers: {
				'Cache-Control': 'public, max-age=31536000, immutable'
			}
		});
	}

	// Regular card OG image
	const allCards = getAllCards();
	const card = allCards.find((c) => c.id === cardId);

	if (!card) {
		return new Response('Card not found', { status: 404 });
	}

	const accentColor = ACCENT_COLORS[card.author_slug] || '#736B62';
	const authorName = AUTHOR_NAMES[card.author_slug] || '';
	const plainText = card.plain_english;
	const len = plainText.length;
	const fontSize = len < 400 ? 32 : len < 700 ? 28 : len < 1000 ? 24 : 20;
	const lineHeight = len < 700 ? '1.45' : '1.4';

	const html = {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'space-between',
				width: '100%',
				height: '100%',
				backgroundColor: '#FAF7F2',
				padding: '60px',
				fontFamily: 'Georgia, serif'
			},
			children: [
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column'
						},
						children: [
							{
								type: 'div',
								props: {
									style: {
										fontSize: '18px',
										color: accentColor,
										marginBottom: '24px',
										fontFamily: 'sans-serif'
									},
									children: `${authorName} — ${card.source_reference}`
								}
							},
							{
								type: 'div',
								props: {
									style: {
										fontSize: `${fontSize}px`,
										color: '#2C2520',
										lineHeight,
										maxWidth: '1080px'
									},
									children: plainText
								}
							}
						]
					}
				},
				{
					type: 'div',
					props: {
						style: {
							fontSize: '16px',
							color: '#736B62',
							fontFamily: 'sans-serif'
						},
						children: 'Plain'
					}
				}
			]
		}
	};

	return new ImageResponse(html, {
		width: 1200,
		height: 630,
		headers: {
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
}
