import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/api'
import type { CompanyCreateResult, CompanySelectFolderResult } from '../shared/company'
import { createCompanyFolder } from './company/scaffold'
import { isTrustedSender } from './ipc-guard'

export function registerCompanyHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.companyCreate,
    async (event, req: unknown): Promise<CompanyCreateResult> => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      if (typeof req !== 'object' || req === null)
        return { ok: false, code: 'invalid-request', message: '요청 형식이 올바르지 않습니다.' }
      const { name, path } = req as Record<string, unknown>
      return createCompanyFolder(name, path)
    }
  )

  // 다이얼로그는 main에서만 연다. renderer는 선택된 경로 문자열만 받는다.
  ipcMain.handle(
    IPC_CHANNELS.companySelectFolder,
    async (event): Promise<CompanySelectFolderResult> => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: '회사 폴더를 만들 위치 선택',
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    }
  )
}
