/**
 * Firebase Functions entry point (Pf39c2-social-pilot-03 T10). This
 * workspace exists to hold exactly one thing: the thin scheduled trigger
 * that starts the social pilot's Cloud Run Job. See `socialTrigger.ts`'s
 * header comment for why it is so small.
 */

export { socialTrigger } from './socialTrigger.js';
