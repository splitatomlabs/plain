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
							flexDirection: 'column'
						},
						children: [
							{
								type: 'div',
								props: {
									style: {
										display: 'flex',
										flexDirection: 'column',
										fontSize: '80px',
										color: '#2C2520',
										lineHeight: 1.1,
										letterSpacing: '-0.01em',
										marginBottom: '28px'
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
										fontSize: '32px',
										color: '#736B62',
										lineHeight: 1.3
									},
									children: 'Read a classic book, one card at a time.'
								}
							}
						]
					}
				},
				{
					type: 'div',
					props: {
						style: {
							display: 'flex',
							fontSize: '28px',
							color: '#2C2520'
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
