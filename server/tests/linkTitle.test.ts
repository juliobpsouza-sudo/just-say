import { describe, expect, it } from 'vitest'
import { firstUrl, isPublicHttpUrl, isYouTubeUrl, titleFromHtml } from '../src/integrations/linkTitle.ts'
import { sameUrl } from '../src/voiceFlow.ts'

describe('link do texto selecionado (D73)', () => {
  it('pega o primeiro link, sem pontuação de fim de frase', () => {
    expect(firstUrl('olha esse: https://youtu.be/abc123. muito bom')).toBe('https://youtu.be/abc123')
    expect(firstUrl('(https://www.youtube.com/watch?v=abc&t=10s)')).toBe('https://www.youtube.com/watch?v=abc&t=10s')
    expect(firstUrl('sem link aqui')).toBeNull()
  })
  it('reconhece links do YouTube', () => {
    for (const u of ['https://www.youtube.com/watch?v=a', 'https://youtu.be/a', 'https://m.youtube.com/shorts/a', 'https://music.youtube.com/watch?v=a'])
      expect(isYouTubeUrl(u), u).toBe(true)
    expect(isYouTubeUrl('https://notyoutube.com/x')).toBe(false)
  })
})

describe('só busca título em endereços públicos', () => {
  it('aceita sites públicos', () => {
    expect(isPublicHttpUrl('https://pt.wikipedia.org/wiki/Brasil')).toBe(true)
    expect(isPublicHttpUrl('http://example.com')).toBe(true)
  })
  it('recusa o PC, a rede local e outros esquemas', () => {
    for (const u of [
      'http://localhost:8787/health',
      'http://127.0.0.1:8787',
      'http://192.168.0.1/admin',
      'http://10.0.0.5',
      'http://172.16.3.4',
      'http://169.254.169.254/latest',
      'http://[::1]:80',
      'http://roteador/',
      'http://impressora.local',
      'file:///C:/Windows',
      'https://user:pass@site.com',
    ])
      expect(isPublicHttpUrl(u), u).toBe(false)
  })
})

describe('título da página', () => {
  it('prefere og:title e decodifica entidades', () => {
    expect(titleFromHtml('<head><meta property="og:title" content="Café &amp; Chá"><title>x</title></head>')).toBe(
      'Café & Chá',
    )
  })
  it('usa o <title> quando não há og:title', () => {
    expect(titleFromHtml('<title>\n  Fone   X1 &#8211; Review\n</title>')).toBe('Fone X1 – Review')
  })
  it('sem título, null', () => {
    expect(titleFromHtml('<html><body>oi</body></html>')).toBeNull()
  })
})

describe('mesmo endereço', () => {
  it('ignora www, barra final e #trecho', () => {
    expect(sameUrl('https://www.youtube.com/watch?v=a', 'https://youtube.com/watch?v=a#t=3')).toBe(true)
    expect(sameUrl('https://site.com/a/', 'https://site.com/a')).toBe(true)
    expect(sameUrl('https://youtube.com/watch?v=a', 'https://youtube.com/watch?v=b')).toBe(false)
  })
})
