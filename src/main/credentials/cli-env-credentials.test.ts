import { describe, expect, it } from 'vitest'
import { buildCliEnv } from '../providers/cli-env'
import { AdapterRegistry } from '../publishing/adapter-registry'
import { createFakeAdapter } from '../publishing/fake-adapter'
import { CredentialService } from './credential-service'
import { CredentialVault } from './credential-vault'
import { SecretRegistry } from './redact'
import { DUMMY_TOKEN, fakeSafeStorage } from './test-helpers'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('cli env and credentials', () => {
  it('does not pass publishing credential variables to CLI children', () => {
    const env = buildCliEnv({
      PATH: '/usr/bin',
      MYCO_PUBLISH_TOKEN: DUMMY_TOKEN,
      PUBLISH_CLIENT_SECRET: DUMMY_TOKEN,
      GITHUB_TOKEN: DUMMY_TOKEN,
      OAUTH_ACCESS_TOKEN: DUMMY_TOKEN
    })
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('ignores empty extra prefixes instead of passing every variable', () => {
    const env = buildCliEnv({ PATH: '/usr/bin', MYCO_PUBLISH_TOKEN: DUMMY_TOKEN }, [''])
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('keeps vault values out of process.env and the CLI env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mc-env-'))
    const fake = createFakeAdapter()
    const registry = new AdapterRegistry([fake], ['fake'])
    const vault = new CredentialVault({
      userDataDir: dir,
      safeStorage: fakeSafeStorage(),
      allowedAdapterIds: ['fake'],
      registry: new SecretRegistry()
    })
    const service = new CredentialService({ vault, registry, openExternal: async () => undefined })
    const before = { ...process.env }
    await fake.connect(service.contextFor('fake'))
    expect(process.env).toEqual(before)
    const all = JSON.stringify(buildCliEnv(process.env, ['ANTHROPIC_']))
    expect(all).not.toContain(DUMMY_TOKEN)
  })
})
