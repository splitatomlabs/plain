import adapter from '@sveltejs/adapter-vercel';

export default {
  kit: {
    adapter: adapter({
      runtime: 'nodejs22.x'
    }),
    prerender: {
      entries: [
        '/',
        '/tags',
        '/tags/calm-your-mind',
        '/tags/facing-fear',
        '/tags/dealing-with-anger',
        '/tags/death-and-mortality',
        '/tags/doing-the-right-thing',
        '/tags/self-discipline',
        '/tags/ambition-and-power',
        '/tags/leading-others',
        '/tags/freedom-and-control',
        '/tags/human-nature',
        '/tags/standing-alone',
        '/tags/what-really-matters',
        '/enchiridion',
        '/meditations',
        '/shortness-of-life',
        '/happy-life',
        '/peace-of-mind'
      ]
    }
  }
};
