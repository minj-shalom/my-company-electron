import { safeStorage, shell } from 'electron'
import { AdapterRegistry } from '../publishing/adapter-registry'
import { createManualAdapter } from '../publishing/manual-adapter'
import { isAllowedExternalUrl } from '../external-url'
import { CredentialService } from './credential-service'
import { CredentialVault } from './credential-vault'

/** 앱 시작 때 보관소·레지스트리·서비스를 한 번 만든다. 실제 플랫폼 어댑터는 후속 티켓이 여기에 등록한다. */
export function createCredentialRuntime(userDataDir: string): {
  registry: AdapterRegistry
  service: CredentialService
} {
  const registry = new AdapterRegistry([createManualAdapter()])
  const vault = new CredentialVault({
    userDataDir,
    safeStorage,
    allowedAdapterIds: registry.credentialAdapterIds()
  })
  const service = new CredentialService({
    vault,
    registry,
    openExternal: async (url) => {
      if (!isAllowedExternalUrl(url)) throw new Error('blocked')
      await shell.openExternal(url)
    }
  })
  return { registry, service }
}
