// Builds with the bundle visualizer on and says where the report is (P9.1).
const { spawnSync } = require('child_process')
const path = require('path')

const result = spawnSync(
  'npx',
  ['electron-vite', 'build', '-c', 'config/electron.vite.config.ts'],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, OSTLER_BUNDLE_REPORT: '1' }
  }
)
if (result.status === 0) {
  process.stdout.write(`Bundle report: ${path.resolve('out/bundle-report.html')}\n`)
}
process.exit(result.status ?? 1)
