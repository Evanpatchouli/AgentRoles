import { spawn } from 'node:child_process'
import path from 'node:path'
import type { SkillDefinition, ToolContext } from './types'
import { json, strArg, truncate } from './types'

function safeCwd(ctx: ToolContext, cwd: string): string {
  const root = path.resolve(
    (ctx.agent.skills.filesystem?.settings.subdir ?? '')
      ? path.join(ctx.workspaceDir, ctx.agent.skills.filesystem.settings.subdir)
      : ctx.workspaceDir
  )
  const target = path.resolve(root, cwd || '.')
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('路径越界：命令只能在当前工作区目录内运行')
  }
  return target
}

function run(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env }
    })
    let stdout = ''
    let stderr = ''
    let finished = false
    let timedOut = false
    const finish = (code: number | null): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1500).unref()
    }, timeoutMs)
    const onAbort = (): void => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1000).unref()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 200000) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 200000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      stderr += '\n' + String(error)
      finish(-1)
    })
    child.on('close', (code) => finish(code))
  })
}

export const shellSkill: SkillDefinition = {
  id: 'shell',
  name: '终端命令',
  icon: '❯',
  description: '在本地工作区执行命令，适合调用本机 CLI、git、脚本。',
  hint: '执行前先用只读命令确认环境；不要执行删除、格式化、发布等破坏性操作，除非用户明确要求。',
  risk: 'high',
  settings: [],
  tools: [
    {
      name: 'run_command',
      description: '在工作区目录执行一条终端命令，返回退出码、stdout 与 stderr。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' },
          cwd: { type: 'string', description: '相对工作区的子目录，可选' },
          timeout_ms: { type: 'number', description: '超时毫秒，默认 60000，最大 180000' }
        },
        required: ['command']
      },
      async execute(args, ctx) {
        const command = strArg(args, 'command').trim()
        if (!command) throw new Error('command 不能为空')
        const cwd = safeCwd(ctx, strArg(args, 'cwd'))
        const timeout = Math.min(180000, Math.max(1000, Number(args.timeout_ms) || 60000))
        const result = await run(command, cwd, timeout, ctx.signal)
        return json({
          cwd,
          exitCode: result.code,
          timedOut: result.timedOut,
          stdout: truncate(result.stdout, 30000),
          stderr: truncate(result.stderr, 10000)
        })
      }
    }
  ]
}
