import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (entry.name.endsWith('.md')) files.push(full)
  }
  return files
}

const files = [
  path.join(root, 'README.md'),
  ...walk(path.join(root, 'docs'))
].filter((file) => fs.existsSync(file))

const missing = []
for (const file of files) {
  const text = fs
    .readFileSync(file, 'utf8')
    .replace(/\`\`\`[\s\S]*?\`\`\`/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
  const links = [...text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
  for (const match of links) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    if (!target || /^(https?:|mailto:|#)/i.test(target)) continue
    target = target.split('#')[0].split('?')[0]
    if (!target) continue
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target))
    if (!fs.existsSync(resolved)) {
      missing.push(path.relative(root, file) + ' -> ' + target)
    }
  }
}

if (missing.length > 0) {
  console.error('[docs] broken relative links:')
  for (const item of missing) console.error(' - ' + item)
  process.exit(1)
}
console.log('[docs] checked', files.length, 'markdown files; relative links OK')
