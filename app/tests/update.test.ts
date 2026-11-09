import { describe, expect, it } from 'vitest'
import { compareVersions, lockDepsChanged, parseVersion, releaseFromFeed } from '../src/shared/update'

describe('versões (D99)', () => {
  it('lê com e sem "v"', () => {
    expect(parseVersion('v0.1.10')).toEqual([0, 1, 10])
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  })
  it('compara número a número, não como texto', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('v0.2.0', '0.1.99')).toBeGreaterThan(0)
    expect(compareVersions('0.1.3', 'v0.1.3')).toBe(0)
    expect(compareVersions('0.1.2', '0.1.3')).toBeLessThan(0)
  })
})

describe('bibliotecas mudaram? (D99)', () => {
  const lock = (app: string, dep: string) =>
    JSON.stringify({ name: 'just-say', version: app, lockfileVersion: 3, packages: { '': { name: 'just-say', version: app }, 'node_modules/x': { version: dep } } })
  it('só a versão do app mudou: reaproveita', () => {
    expect(lockDepsChanged(lock('0.1.3', '1.0.0'), lock('0.1.4', '1.0.0'))).toBe(false)
  })
  it('uma biblioteca mudou: instala de novo', () => {
    expect(lockDepsChanged(lock('0.1.3', '1.0.0'), lock('0.1.4', '1.0.1'))).toBe(true)
  })
  it('arquivo ilegível conta como mudança', () => {
    expect(lockDepsChanged('{', lock('0.1.4', '1.0.0'))).toBe(true)
  })
})

describe('feed de versões (D99)', () => {
  it('lê o Release do GitHub', () => {
    const r = releaseFromFeed({
      tag_name: 'v0.1.4',
      zipball_url: 'https://api.github.com/repos/x/y/zipball/v0.1.4',
      html_url: 'https://github.com/x/y/releases/tag/v0.1.4',
      body: '- novidade',
    })
    expect(r).toMatchObject({ version: '0.1.4', tag: 'v0.1.4', notes: '- novidade' })
  })
  it('prefere o zip_url de um feed de teste', () => {
    expect(releaseFromFeed({ tag_name: 'v9.9.9', zip_url: 'http://127.0.0.1/x.zip', zipball_url: 'z' })?.zipUrl).toBe('http://127.0.0.1/x.zip')
  })
  it('ignora rascunho, pré-versão e resposta estranha', () => {
    expect(releaseFromFeed({ tag_name: 'v1.0.0', zipball_url: 'z', draft: true })).toBeNull()
    expect(releaseFromFeed({ tag_name: 'v1.0.0', zipball_url: 'z', prerelease: true })).toBeNull()
    expect(releaseFromFeed({ tag_name: 'qualquer', zipball_url: 'z' })).toBeNull()
    expect(releaseFromFeed({ message: 'API rate limit exceeded' })).toBeNull()
    expect(releaseFromFeed(null)).toBeNull()
  })
})
