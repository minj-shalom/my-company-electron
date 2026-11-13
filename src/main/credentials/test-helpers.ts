import type { SafeStorageLike } from './credential-vault'

/** 테스트 전용 가짜 safeStorage. 평문이 그대로 보이지 않도록 뒤집어 base64로 감싼다 (진짜 암호화가 아니다). */
export function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) =>
      Buffer.from(`enc1:${Buffer.from([...plain].reverse().join('')).toString('base64')}`),
    decryptString: (cipher) => {
      const text = cipher.toString()
      if (!text.startsWith('enc1:')) throw new Error('bad cipher')
      return [...Buffer.from(text.slice(5), 'base64').toString()].reverse().join('')
    }
  }
}

/** 코드에 쓰는 더미 값. 실제 토큰이 아니다. */
export const DUMMY_TOKEN = 'dummy-token-not-real-0001'
