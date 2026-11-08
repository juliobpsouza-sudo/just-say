// Markdown das respostas do Just Ask: HTML para colar rico e para o
// cartão, e texto puro para os apps que só aceitam texto.
// O HTML daqui ainda passa pelo DOMPurify no renderer antes de ser usado.
import MarkdownIt from 'markdown-it'

// html: false = HTML cru vindo do modelo é escapado, nunca interpretado.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })

// Só links http/https/mailto (o markdown-it já bloqueia javascript:, mas fica explícito).
const defaultValidate = md.validateLink.bind(md)
md.validateLink = (url: string) => /^(https?:|mailto:)/i.test(url.trim()) && defaultValidate(url)

export function markdownToHtml(markdown: string): string {
  return md.render(markdown).trim()
}

/** Texto puro a partir do markdown: tira a marcação e mantém listas, tabelas e quebras. */
export function markdownToPlain(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inFence = false
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(raw)
      continue
    }
    // Linha separadora de tabela (|---|:--:|)
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(raw)) continue
    let line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, '') // títulos
      .replace(/^\s{0,3}>\s?/, '') // citação
      .replace(/^(\s*)[*+]\s+/, '$1- ') // marcadores viram "-"
      .replace(/^\s*([-*_]\s*){3,}$/, '') // linha horizontal
    // Tabela: | a | b | → a	b
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim())
        .join('\t')
    }
    line = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // imagem → texto alternativo
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, text: string, url: string) => (text === url ? url : `${text} (${url})`))
      .replace(/(\*\*|__)(.+?)\1/g, '$2') // negrito
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2') // itálico com *
      .replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1$2') // itálico com _
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
    out.push(line)
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
