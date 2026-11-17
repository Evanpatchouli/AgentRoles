import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = String(pkg.version || '').trim()

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('[release] package.json 的 version 不是合法版本号：' + JSON.stringify(version))
  process.exit(1)
}

const outputDir = path.join(root, 'release', version)
const relativeOutput = path.relative(root, outputDir).split(path.sep).join('/')
const electronVite = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const electronBuilder = path.join(root, 'node_modules', 'electron-builder', 'cli.js')

function run(command, args, label) {
  console.log('[release] ' + label + '：' + [command, ...args].join(' '))
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  const units = ['KB', 'MB', 'GB']
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return size.toFixed(size >= 10 ? 0 : 1) + ' ' + units[unit]
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

console.log('[release] 版本：' + version)
console.log('[release] 输出目录：' + relativeOutput)

// 每次发布都从空目录开始，避免旧版本产物混入 release/<version>/。
fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })

run(process.execPath, [electronVite, 'build'], '构建主进程、preload 与渲染层')
run(
  process.execPath,
  [
    electronBuilder,
    '--win',
    'nsis',
    '--publish',
    'never',
    '-c.directories.output=' + relativeOutput
  ],
  '打包 Windows 安装包'
)

const artifacts = fs
  .readdirSync(outputDir)
  .filter((name) => /\.(exe|blockmap)$/i.test(name))
  .filter((name) => fs.statSync(path.join(outputDir, name)).isFile())
  .sort()

if (!artifacts.some((name) => /\.exe$/i.test(name))) {
  console.error('[release] 没有找到安装包，构建可能失败。')
  process.exit(1)
}

const checksums = artifacts.map(
  (name) => sha256(path.join(outputDir, name)) + '  ' + name
)
fs.writeFileSync(path.join(outputDir, 'SHA256SUMS.txt'), checksums.join('\n') + '\n', 'utf8')

console.log('[release] 产物：')
for (const name of artifacts) {
  const bytes = fs.statSync(path.join(outputDir, name)).size
  console.log('  - ' + name + '（' + formatBytes(bytes) + '）')
}
console.log('[release] 校验清单：' + relativeOutput + '/SHA256SUMS.txt')
console.log('[release] 下一步：')
console.log('  git add -A && git commit -m "chore(release): 发布 v' + version + '"')
console.log('  git tag v' + version + ' && git push origin main --tags')
console.log(
  '  gh release create v' +
    version +
    ' ' +
    relativeOutput +
    '/AgentRoles.Setup.' +
    version +
    '.exe --title "AgentRoles v' +
    version +
    '" --notes-file <notes.md>'
)
