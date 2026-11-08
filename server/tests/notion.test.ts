import { describe, expect, it } from 'vitest'
import {
  cleanPageTitle,
  folderFromCommand,
  folderFromSearchResult,
  noteChildren,
  pickFolder,
  rowProperties,
  todoBlock,
  type NotionFolder,
} from '../src/integrations/notion.ts'
import { parseAskDecision } from '../src/refine/askPrompts.ts'

const folders: NotionFolder[] = [
  { id: 'a', kind: 'data_source', title: 'Vídeos para assistir depois', url: null },
  { id: 'b', kind: 'page', title: 'Trabalho', url: null },
  { id: 'c', kind: 'page', title: 'Ideias', url: null },
]

describe('pasta pelo tipo de coisa, sem nome falado (D90)', () => {
  const mine: NotionFolder[] = [
    { id: 'v', kind: 'page', title: 'Videos', url: null },
    { id: 'r', kind: 'page', title: 'Repositórios GitHub', url: null },
    { id: 'i', kind: 'page', title: 'Ideias', url: null },
  ]
  it('"anota esse repositório" vai para Repositórios GitHub', () => {
    expect(folderFromCommand(mine, 'anota esse repositório')?.id).toBe('r')
    expect(folderFromCommand(mine, 'salva esse repositório pra eu ver depois')?.id).toBe('r')
    expect(folderFromCommand(mine, 'guarda esse projeto do GitHub')?.id).toBe('r')
  })
  it('"anota esse vídeo" vai para Videos', () => {
    expect(folderFromCommand(mine, 'anota esse vídeo pra eu ver mais tarde')?.id).toBe('v')
  })
  it('sem pista ou com empate: null (fica a pasta padrão)', () => {
    expect(folderFromCommand(mine, 'anota isso aqui')).toBeNull()
    expect(folderFromCommand(mine, 'anota esse vídeo sobre repositórios')).toBeNull()
  })
})

describe('pastas do Notion', () => {
  it('lê data source e página da busca; linha de banco não é pasta', () => {
    expect(folderFromSearchResult({ object: 'data_source', id: 'x', title: [{ plain_text: 'Assistir' }], url: 'u' })).toEqual({
      id: 'x',
      kind: 'data_source',
      title: 'Assistir',
      url: 'u',
    })
    expect(
      folderFromSearchResult({
        object: 'page',
        id: 'p',
        parent: { type: 'page_id' },
        properties: { title: { type: 'title', title: [{ plain_text: 'Ideias' }] } },
      }),
    ).toMatchObject({ kind: 'page', title: 'Ideias' })
    expect(folderFromSearchResult({ object: 'page', id: 'r', parent: { type: 'data_source_id' }, properties: {} })).toBeNull()
  })

  it('acha a pasta pelo nome falado, sem acento e por pedaço', () => {
    expect(pickFolder(folders, 'assistir depois', null)?.id).toBe('a')
    expect(pickFolder(folders, 'pra ver mais tarde os videos', null)?.id).toBe('a')
    expect(pickFolder(folders, 'pasta do Trabalho', null)?.id).toBe('b')
    expect(pickFolder(folders, 'ideias', null)?.id).toBe('c')
  })
  it('sem nome: a padrão; sem padrão e com uma pasta só: ela; senão nenhuma', () => {
    expect(pickFolder(folders, '', 'b')?.id).toBe('b')
    expect(pickFolder(folders, 'pasta que não existe', 'c')?.id).toBe('c')
    expect(pickFolder([folders[0]], null, null)?.id).toBe('a')
    expect(pickFolder(folders, null, null)).toBeNull()
  })
})

describe('nota', () => {
  it('limpa o título do YouTube', () => {
    expect(cleanPageTitle('(3) Como fazer pão caseiro - YouTube')).toBe('Como fazer pão caseiro')
    expect(cleanPageTitle('Artigo - YouTube - Google Chrome')).toBe('Artigo')
    expect(cleanPageTitle('GitHub - remotion-dev/remotion: Make videos programmatically with React')).toBe(
      'remotion-dev/remotion: Make videos programmatically with React',
    )
  })
  it('linha de banco: título, link e data nas colunas que existirem', () => {
    const schema = { Nome: { type: 'title' }, Link: { type: 'url' }, Adicionado: { type: 'date' }, Visto: { type: 'checkbox' } }
    expect(rowProperties(schema, { title: 'Vídeo X', url: 'https://youtu.be/1' }, '2026-10-15')).toEqual({
      Nome: { title: [{ text: { content: 'Vídeo X' } }] },
      Link: { url: 'https://youtu.be/1' },
      Adicionado: { date: { start: '2026-10-15' } },
    })
    // Sem coluna de link: só o título (o link vai no corpo).
    expect(Object.keys(rowProperties({ Tarefa: { type: 'title' } }, { title: 'T', url: 'https://x' }, '2026-10-15'))).toEqual(['Tarefa'])
  })
  it('item ☐: título como link e desmarcado', () => {
    expect(todoBlock({ title: 'Vídeo X', url: 'https://youtu.be/1' })).toEqual({
      object: 'block',
      type: 'to_do',
      to_do: { rich_text: [{ type: 'text', text: { content: 'Vídeo X', link: { url: 'https://youtu.be/1' } } }], checked: false },
    })
  })
  it('corpo: link com prévia e parágrafos', () => {
    expect(noteChildren({ title: 't', url: 'https://x', text: 'um\n\ndois' }).map((b) => b.type)).toEqual([
      'bookmark',
      'paragraph',
      'paragraph',
    ])
    expect(noteChildren({ title: 't' })).toEqual([])
  })
})

describe('decisão "anotar" no Just Ask', () => {
  it('lê pasta, título, texto e link', () => {
    const d = parseAskDecision(
      '<acao>anotar</acao><pasta>assistir depois</pasta><titulo>Como calibrar a A1</titulo><texto></texto><link>https://youtu.be/1</link>',
      'anota esse vídeo pra ver depois',
      false,
    )
    expect(d).toMatchObject({ action: 'anotar', folder: 'assistir depois', title: 'Como calibrar a A1', url: 'https://youtu.be/1' })
  })
  it('título com "s" e espaços sobrando fica intacto (bug do "Ju t Say")', () => {
    expect(parseAskDecision('<acao>anotar</acao><titulo>  TESTE do Just   Say  </titulo>', 'anota', false).title).toBe('TESTE do Just Say')
  })
  it('link inválido não vai', () => {
    expect(parseAskDecision('<acao>anotar</acao><titulo>x</titulo><link>javascript:1</link>', 'anota', false).url).toBe('')
  })
})
