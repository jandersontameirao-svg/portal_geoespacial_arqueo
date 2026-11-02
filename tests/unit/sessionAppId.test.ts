import { describe, expect, it } from 'vitest';
import { sdk } from '../../server/_core/sdk';

// F3: o token precisa ser assinado para este app, não só ter assinatura válida.
describe('session binding to app id', () => {
  it('rejects a correctly signed session issued for another app', async () => {
    const token = await sdk.signSession({ openId: 'synthetic-1', appId: 'synthetic-other-app', name: 'Synthetic' });
    await expect(sdk.verifySession(token)).resolves.toBeNull();
  });
  it('accepts a session issued for this app', async () => {
    const token = await sdk.createSessionToken('synthetic-1', { name: 'Synthetic' });
    await expect(sdk.verifySession(token)).resolves.toMatchObject({ openId: 'synthetic-1' });
  });
});
