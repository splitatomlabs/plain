import { ImageResponse } from '@vercel/og';

const ACCENT_COLORS = ['#B5704F', '#5B6E8A', '#6B7F5E'];

export async function GET() {
	const html = {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'center',
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
						style: { display: 'flex', gap: '16px', marginBottom: '48px' },
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
							fontSize: '96px',
							color: '#2C2520',
							lineHeight: 1.1,
							letterSpacing: '-0.02em',
							marginBottom: '32px'
						},
						children: [
							{ type: 'div', props: { children: 'Ancient philosophy,' } },
							{ type: 'div', props: { children: 'in plain English.' } }
						]
					}
				},
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							fontSize: '40px',
							color: '#736B62',
							lineHeight: 1.3
						},
						children: 'Read a classic book, one card at a time.'
					}
				}
			]
		}
	};

	return new ImageResponse(html, {
		width: 1200,
		height: 630,
		headers: {
			'Cache-Control': 'public, max-age=3600, s-maxage=3600'
		}
	});
}
