import adapter from '@sveltejs/adapter-vercel';

export default {
  kit: {
    adapter: adapter({
      runtime: 'nodejs22.x'
    }),
    prerender: {
      handleHttpError: 'warn',
      entries: [
        '/',
        '/tags',
        '/tags/calm-your-mind',
        '/tags/death-and-mortality',
        '/tags/doing-the-right-thing',
        '/tags/facing-hardship',
        '/tags/freedom-and-control',
        '/tags/human-nature',
        '/tags/knowing-yourself',
        '/tags/what-matters-most',
        '/enchiridion',
        '/meditations',
        '/shortness-of-life',
        '/happy-life',
        '/peace-of-mind',
        '/discourses'
      ]
    }
  }
};
