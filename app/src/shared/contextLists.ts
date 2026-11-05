// Listas de apps e sites, reescritas como configuração própria.
// - Bloqueio: não lemos o texto da tela nem do campo (apps sensíveis ou que expõem mal o texto).
// - Editável: o campo aceita colar mesmo quando a acessibilidade diz que não (sem cartão de copiar).
// - Markdown: o campo mostra formatação markdown (listas, negrito).
// O usuário edita as duas listas de bloqueio em Configurações → Privacidade.

export const CONTEXT_LISTS_VERSION = 'just-say-1.0.0'

export const DEFAULT_BLOCKED_APPS: readonly string[] = [
  // gerenciadores de senha
  'keepass.exe',
  'keepassxc.exe',
  '1password.exe',
  'bitwarden.exe',
  'dashlane.exe',
  'lastpass.exe',
  'enpass.exe',
  'proton pass.exe',
  // conversas privadas
  'whatsapp.exe',
  'telegram.exe',
  'signal.exe',
  // terminais (o texto da tela é ruído e pode ter segredos)
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'windowsterminal.exe',
  'wt.exe',
  'conhost.exe',
  'mintty.exe',
  'warp.exe',
  // acesso remoto e máquinas virtuais (a tela é de outro computador)
  'mstsc.exe',
  'anydesk.exe',
  'teamviewer.exe',
  'vmconnect.exe',
  'vmware.exe',
  'virtualbox.exe',
  // Office: expõe o documento inteiro de um jeito lento e ruim
  'winword.exe',
  'excel.exe',
  'powerpnt.exe',
  'outlook.exe',
]

export const DEFAULT_BLOCKED_SITES: readonly string[] = [
  // conversas privadas
  'web.whatsapp.com',
  'web.telegram.org',
  // contas, senhas e pagamentos
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'paypal.com',
  'mercadopago.com.br',
  'pagseguro.uol.com.br',
  // bancos brasileiros
  'bb.com.br',
  'caixa.gov.br',
  'itau.com.br',
  'bradesco.com.br',
  'santander.com.br',
  'nubank.com.br',
  'bancointer.com.br',
  'inter.co',
  'c6bank.com.br',
  'btgpactual.com',
  'sicoob.com.br',
  'sicredi.com.br',
  // governo
  'gov.br',
  // documentos em canvas (a acessibilidade não traz o texto)
  'docs.google.com',
]

/** O campo aceita colar mesmo quando a acessibilidade diz que não é editável. */
export const EDITABLE_APPS: readonly string[] = [
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'windowsterminal.exe',
  'wt.exe',
  'mintty.exe',
  'warp.exe',
  'code.exe',
  'cursor.exe',
  'windsurf.exe',
  'zed.exe',
  'discord.exe',
  'slack.exe',
  'whatsapp.exe',
  'telegram.exe',
  'ms-teams.exe',
  'teams.exe',
  'obsidian.exe',
  'notion.exe',
  'winword.exe',
  'excel.exe',
  'powerpnt.exe',
  'outlook.exe',
  'olk.exe',
  'figma.exe',
  'claude.exe',
  'chatgpt.exe',
]

export const EDITABLE_SITES: readonly string[] = ['docs.google.com', 'web.whatsapp.com', 'web.telegram.org', 'canva.com']

/** O campo mostra markdown (listas, negrito). */
export const MARKDOWN_APPS: readonly string[] = ['discord.exe', 'obsidian.exe', 'notion.exe', 'slack.exe', 'claude.exe', 'chatgpt.exe']

export const MARKDOWN_SITES: readonly string[] = [
  'github.com',
  'gitlab.com',
  'discord.com',
  'app.slack.com',
  'notion.so',
  'linear.app',
  'chatgpt.com',
  'claude.ai',
  'gemini.google.com',
  'reddit.com',
  'stackoverflow.com',
]

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase()
    return host.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

function appMatches(exe: string, list: readonly string[]): boolean {
  const e = exe.toLowerCase()
  return list.some((a) => a.toLowerCase() === e)
}

/** "bb.com.br" vale para "bb.com.br" e para "www2.bb.com.br". */
function siteMatches(domain: string | null, list: readonly string[]): boolean {
  if (!domain) return false
  return list.some((s) => {
    const site = s.toLowerCase().replace(/^www\./, '')
    return domain === site || domain.endsWith(`.${site}`)
  })
}

export interface ContextPolicy {
  /** Não ler o texto da tela nem do campo. */
  blockScreen: boolean
  /** Por que não lê: lista de bloqueio, configuração desligada ou nada. */
  blockReason: 'blocked_app' | 'blocked_site' | 'setting_off' | null
  /** Colar funciona aqui mesmo sem campo editável detectado (sem cartão de copiar). */
  editableWhitelisted: boolean
  supportsMarkdown: boolean
  domain: string | null
}

export interface ContextPolicyInput {
  exeName: string
  url: string | null
  readScreenContext: boolean
  blockedApps: readonly string[]
  blockedSites: readonly string[]
}

export function contextPolicy(input: ContextPolicyInput): ContextPolicy {
  const domain = domainOf(input.url)
  const blockedApp = appMatches(input.exeName, input.blockedApps)
  const blockedSite = siteMatches(domain, input.blockedSites)
  const blockReason = !input.readScreenContext
    ? 'setting_off'
    : blockedApp
      ? 'blocked_app'
      : blockedSite
        ? 'blocked_site'
        : null
  return {
    blockScreen: blockReason !== null,
    blockReason,
    editableWhitelisted: appMatches(input.exeName, EDITABLE_APPS) || siteMatches(domain, EDITABLE_SITES),
    supportsMarkdown: appMatches(input.exeName, MARKDOWN_APPS) || siteMatches(domain, MARKDOWN_SITES),
    domain,
  }
}
