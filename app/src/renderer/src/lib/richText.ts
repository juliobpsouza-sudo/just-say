// Markdown → HTML limpo (DOMPurify) + texto puro, para colar rico e para o cartão de resposta.
import DOMPurify from 'dompurify'
import { markdownToHtml, markdownToPlain } from '../../../shared/markdown'

export interface RichText {
  html: string
  text: string
  markdown: string
}

export function richFromMarkdown(markdown: string): RichText {
  const html = DOMPurify.sanitize(markdownToHtml(markdown), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'img'],
    FORBID_ATTR: ['style'],
  })
  return { html, text: markdownToPlain(markdown), markdown }
}
