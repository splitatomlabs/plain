import { browser, dev } from '$app/environment';

let analyticsEnabled = false;

if (browser && !dev) {
	analyticsEnabled = navigator.doNotTrack !== '1';
}

export function trackEvent(name, properties = {}) {
	if (!analyticsEnabled) return;
	try {
		// @vercel/analytics track function is injected via the Analytics component
		if (typeof window !== 'undefined' && window.va) {
			window.va('event', { name, ...properties });
		}
	} catch {
		// Analytics unavailable
	}
}
