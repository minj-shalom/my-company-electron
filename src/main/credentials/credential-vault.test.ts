import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CredentialVault, VaultError } from './credential-vault'
import { SecretRegistry } from './redact'
import { DUMMY_TOKEN, fakeSafeStorage } from './test-helpers'

async function setup(
  available = true
): Promise<{ dir: string; vault: CredentialVault; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-vault-'))
  const vault = new CredentialVault({
    userDataDir: dir,
    safeStorage: fakeSafeStorage(available),
    allowedAdapterIds: ['fake'],
    registry: new SecretRegistry()
  })
  return { dir, vault, file: join(dir, 'credentials', 'vault.json') }
}
const meta = { displayName: '테스트 블로그', expiresAt: null }

describe('credential vault', () => {
  it('round-trips a value and never stores plaintext', async () => {
    const { vault, file } = await setup()
    await vault.set('fake:blog', DUMMY_TOKEN, meta)
    expect(await vault.get('fake:blog')).toBe(DUMMY_TOKEN)
    expect(await readFile(file, 'utf8')).not.toContain(DUMMY_TOKEN)
    expect(await vault.accounts('fake')).toEqual([
      { accountId: 'blog', displayName: '테스트 블로그', expiresAt: null }
    ])
  })

  it('restricts file and folder permissions', async () => {
    if (process.platform === 'win32') return
    const { vault, file, dir } = await setup()
    await vault.set('fake:blog', DUMMY_TOKEN, meta)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await stat(join(dir, 'credentials'))).mode & 0o777).toBe(0o700)
  })

  it('refuses when encryption is unavailable and writes nothing', async () => {
    const { vault, file } = await setup(false)
    await expect(vault.set('fake:blog', DUMMY_TOKEN, meta)).rejects.toMatchObject({
      code: 'encryption-unavailable'
    })
    await expect(readFile(file, 'utf8')).rejects.toThrow()
    await expect(vault.get('fake:blog')).rejects.toBeInstanceOf(VaultError)
  })

  it('accepts only allow-listed adapter ids and well-formed account ids', async () => {
    const { vault } = await setup()
    for (const key of [
      'other:blog',
      'fake',
      ':blog',
      'fake:',
      'fake:../x',
      'fake:A B',
      'fake:a:b',
      '__proto__:x'
    ])
      await expect(vault.set(key, DUMMY_TOKEN, meta)).rejects.toMatchObject({ code: 'invalid-key' })
    await expect(vault.get('other:blog')).rejects.toMatchObject({ code: 'invalid-key' })
  })

  it('rejects bad values and metadata', async () => {
    const { vault } = await setup()
    for (const v of ['', 'short', 'x'.repeat(9000), `abc\0defgh`])
      await expect(vault.set('fake:blog', v, meta)).rejects.toMatchObject({ code: 'invalid-value' })
    await expect(
      vault.set('fake:blog', DUMMY_TOKEN, { displayName: ' ', expiresAt: null })
    ).rejects.toBeTruthy()
    await expect(
      vault.set('fake:blog', DUMMY_TOKEN, { displayName: 'a', expiresAt: 'not-a-date' })
    ).rejects.toBeTruthy()
  })

  it('deletes values and is idempotent', async () => {
    const { vault } = await setup()
    await vault.set('fake:blog', DUMMY_TOKEN, meta)
    await vault.delete('fake:blog')
    await vault.delete('fake:blog')
    expect(await vault.get('fake:blog')).toBeNull()
  })

  it('keeps concurrent writes', async () => {
    const { vault } = await setup()
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((n) => vault.set(`fake:${n}`, `${DUMMY_TOKEN}-${n}`, meta))
    )
    expect((await vault.accounts('fake')).length).toBe(4)
  })

  it('does not overwrite a corrupt file and leaks nothing in errors', async () => {
    const { vault, file, dir } = await setup()
    await vault.set('fake:blog', DUMMY_TOKEN, meta)
    await writeFile(file, '{broken')
    const err = await vault.set('fake:other', DUMMY_TOKEN, meta).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'storage-failed' })
    expect(String((err as Error).message)).not.toContain(DUMMY_TOKEN)
    expect(String((err as Error).message)).not.toContain(dir)
    expect(await readFile(file, 'utf8')).toBe('{broken')
  })
})
