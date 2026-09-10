/**
 * `writeAgentGuide` mirrors `shared/agent-guide.md` into a project's vault,
 * verbatim, once per project open — the audience the bridge's briefing gate
 * structurally cannot reach: a coding agent editing vault files directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeAgentGuide } from './vaultManager'

describe('writeAgentGuide', () => {
  let appRoot: string
  let vaultDir: string
  const originalAppRoot = process.env.APP_ROOT

  beforeEach(() => {
    appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-approot-'))
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovh-vault-'))
    process.env.APP_ROOT = appRoot
  })

  afterEach(() => {
    fs.rmSync(appRoot, { recursive: true, force: true })
    fs.rmSync(vaultDir, { recursive: true, force: true })
    if (originalAppRoot === undefined) delete process.env.APP_ROOT
    else process.env.APP_ROOT = originalAppRoot
  })

  it('writes a byte-identical OVERHEAD.md into the vault', () => {
    const content = '# Overhead — how this app works\n\nSome guide text.\n'
    fs.mkdirSync(path.join(appRoot, 'shared'), { recursive: true })
    fs.writeFileSync(path.join(appRoot, 'shared', 'agent-guide.md'), content, 'utf8')

    writeAgentGuide(vaultDir)

    const written = fs.readFileSync(path.join(vaultDir, 'OVERHEAD.md'), 'utf8')
    expect(written).toBe(content)
  })

  it('logs a warning and does not throw when the source file is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => writeAgentGuide(vaultDir)).not.toThrow()
    expect(warn).toHaveBeenCalled()
    expect(fs.existsSync(path.join(vaultDir, 'OVERHEAD.md'))).toBe(false)
    warn.mockRestore()
  })
})
