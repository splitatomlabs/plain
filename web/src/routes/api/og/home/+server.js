import { ImageResponse } from '@vercel/og';

const ACCENT_COLORS = ['#B5704F', '#5B6E8A', '#6B7F5E'];

export async function GET() {
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
				padding: '80px',
				fontFamily: 'Georgia, serif'
			},
			children: [
				{
					type: 'div',
					props: {
						style: { display: 'flex', gap: '16px' },
						children: ACCENT_COLORS.map((color) => ({
							type: 'div',
							props: {
								style: {
									width: '56px',
									height: '6px',
									backgroundColor: color,
									borderRadius: '3px'
								}
							}
						}))
					}
				},
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							flexDirection: 'column',
							fontSize: '64px',
							color: '#2C2520',
							lineHeight: 1.2,
							letterSpacing: '-0.01em'
						},
						children: [
							{ type: 'div', props: { children: 'Three men.' } },
							{ type: 'div', props: { children: 'Three completely different lives.' } },
							{ type: 'div', props: { children: 'The same philosophy.' } }
						]
					}
				},
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							fontSize: '22px',
							color: '#736B62',
							fontFamily: 'sans-serif',
							letterSpacing: '0.02em'
						},
						children: 'Plain — Ancient philosophy, in plain English'
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
