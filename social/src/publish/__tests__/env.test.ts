import { describe, expect, it } from 'vitest';
import { GCS_ENV_VARS, GCS_PUBLIC_BASE_URL_ENV_VAR, loadGcsConfig, type GcsConfig } from '../env.js';

const VALID_ENV: NodeJS.ProcessEnv = {
	GCS_BUCKET_NAME: 'plain-social-media',
	GCS_PUBLIC_BASE_URL: 'https://media.thinkplain.ai',
};

describe('loadGcsConfig', () => {
	it('returns the parsed config when every variable is present', () => {
		const config: GcsConfig = loadGcsConfig(VALID_ENV);

		expect(config).toEqual({
			bucketName: 'plain-social-media',
			publicBaseUrl: 'https://media.thinkplain.ai',
		});
	});

	it('omits publicBaseUrl from the returned config when it is unset', () => {
		const env = { ...VALID_ENV };
		delete env[GCS_PUBLIC_BASE_URL_ENV_VAR];

		const config = loadGcsConfig(env);

		expect(config).toEqual({ bucketName: 'plain-social-media' });
		expect(config.publicBaseUrl).toBeUndefined();
	});

	it('omits publicBaseUrl from the returned config when it is blank', () => {
		const env = { ...VALID_ENV, [GCS_PUBLIC_BASE_URL_ENV_VAR]: '' };

		const config = loadGcsConfig(env);

		expect(config).toEqual({ bucketName: 'plain-social-media' });
	});

	it(`throws naming "${GCS_ENV_VARS.bucketName}" when it is missing`, () => {
		const env = { ...VALID_ENV };
		delete env[GCS_ENV_VARS.bucketName];

		expect(() => loadGcsConfig(env)).toThrowError(new RegExp(GCS_ENV_VARS.bucketName));
	});

	it(`throws naming "${GCS_ENV_VARS.bucketName}" when it is blank`, () => {
		const env = { ...VALID_ENV, [GCS_ENV_VARS.bucketName]: '' };

		expect(() => loadGcsConfig(env)).toThrowError(new RegExp(GCS_ENV_VARS.bucketName));
	});

	it('never leaks the value of a variable that WAS set into the thrown message', () => {
		const env = { ...VALID_ENV };
		delete env[GCS_ENV_VARS.bucketName];

		try {
			loadGcsConfig(env);
			throw new Error('expected loadGcsConfig to throw');
		} catch (err) {
			const message = (err as Error).message;
			expect(message).not.toContain(VALID_ENV.GCS_PUBLIC_BASE_URL);
		}
	});
});
