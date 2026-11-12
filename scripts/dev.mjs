// electron-vite는 --host를 모르므로 여기서 가로챈다.
// `npm run dev`: Electron 창, `npm run dev -- --host`: renderer dev 서버를 LAN에 노출해 브라우저에서도 볼 수 있다(Electron 밖에서는 window.api mock).
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const host = args.includes('--host')
const rest = args.filter((a) => a !== '--host')
const viteArgs = ['electron-vite', 'dev', ...rest]

const child = spawn('npx', viteArgs, {
  stdio: 'inherit',
  env: { ...process.env, ...(host ? { MC_DEV_HOST: '1' } : {}) }
})
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
