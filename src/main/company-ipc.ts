import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/api'
import type {
  CompanyCreateResult,
  CompanyFolderPurpose,
  CompanyOpenResult,
  CompanySelectFolderResult,
  CompanyState
} from '../shared/company'
import { CompanyService } from './company/company-service'
import { isTrustedSender } from './ipc-guard'

const DIALOG_TITLES: Record<CompanyFolderPurpose, string> = {
  'create-location': '회사 폴더를 만들 위치 선택',
  open: '열 회사 폴더 선택'
}

export function registerCompanyHandlers(service: CompanyService): void {
  ipcMain.handle(
    IPC_CHANNELS.companyCreate,
    async (event, req: unknown): Promise<CompanyCreateResult> => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      return service.create(req)
    }
  )

  // 다이얼로그는 main에서만 연다. renderer는 선택된 경로 문자열만 받는다.
  ipcMain.handle(
    IPC_CHANNELS.companySelectFolder,
    async (event, purposeInput: unknown): Promise<CompanySelectFolderResult> => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      const purpose = CompanyService.parsePurpose(purposeInput)
      const win = BrowserWindow.fromWebContents(event.sender)
      return service.selectFolder(purpose, async (p) => {
        const options = {
          title: DIALOG_TITLES[p],
          properties: ['openDirectory', 'createDirectory'] as (
            'openDirectory' | 'createDirectory'
          )[]
        }
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.companyOpen,
    async (event, req: unknown): Promise<CompanyOpenResult> => {
      if (!isTrustedSender(event)) throw new Error('Untrusted sender')
      return service.open(req)
    }
  )

  ipcMain.handle(IPC_CHANNELS.companyCurrent, (event): CompanyState => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return service.current()
  })
}
