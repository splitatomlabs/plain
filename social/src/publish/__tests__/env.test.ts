import { describe, expect, it } from 'vitest';
import { loadR2Config, R2_ENV_VARS, type R2Config } from '../env.js';

const VALID_ENV: NodeJS.ProcessEnv = {
	R2_ACCOUNT_ID: 'test-account-id',
	R2_BUCKET_NAME: 'plain-social-media',
	R2_ACCESS_KEY_ID: 'test-access-key-id',
	R2_SECRET_ACCESS_KEY: 'super-secret-value-do-not-log',
	R2_PUBLIC_BASE_URL: 'https://media.thinkplain.ai',
};

describe('loadR2Config', () => {
	it('returns the parsed config when every variable is present', () => {
		const config: R2Config = loadR2Config(VALID_ENV);

		expect(config).toEqual({
			accountId: 'test-account-id',
			bucketName: 'plain-social-media',
			accessKeyId: 'test-access-key-id',
			secretAccessKey: 'super-secret-value-do-not-log',
			publicBaseUrl: 'https://media.thinkplain.ai',
		});
	});

	for (const name of Object.values(R2_ENV_VARS)) {
		it(`throws naming "${name}" when it is missing`, () => {
			const env = { ...VALID_ENV };
			delete env[name];

			expect(() => loadR2Config(env)).toThrowError(new RegExp(name));
		});

		it(`throws naming "${name}" when it is blank`, () => {
			const env = { ...VALID_ENV, [name]: '' };

			expect(() => loadR2Config(env)).toThrowError(new RegExp(name));
		});
	}

	it('never leaks the value of a secret that WAS set into the thrown message', () => {
		const env = { ...VALID_ENV };
		delete env.R2_PUBLIC_BASE_URL;

		try {
			loadR2Config(env);
			throw new Error('expected loadR2Config to throw');
		} catch (err) {
			const message = (err as Error).message;
			expect(message).not.toContain(VALID_ENV.R2_ACCESS_KEY_ID);
			expect(message).not.toContain(VALID_ENV.R2_SECRET_ACCESS_KEY);
			expect(message).not.toContain(VALID_ENV.R2_ACCOUNT_ID);
		}
	});
});
