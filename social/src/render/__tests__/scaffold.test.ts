import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Placeholder test so `npm test --prefix social` exits 0 instead of failing on
// "no test files found". Later tasks (renderer, encoder, audio) will replace
// this with real coverage.
describe('social workspace scaffold', () => {
	it('loads and parses package.json as an ESM project', () => {
		const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url));
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

		expect(pkg.name).toBe('plain-social');
		expect(pkg.type).toBe('module');
		expect(pkg.scripts.test).toBe('vitest run');
	});
});
