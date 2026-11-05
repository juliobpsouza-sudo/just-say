// Compila as DLLs nativas (native/) com o CMake + MSVC do Visual Studio Build Tools
// e copia o resultado para resources/native/, de onde o app carrega via koffi.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nativeDir = join(root, 'native')
// Fora do OneDrive: build intermediário não precisa sincronizar.
const buildDir = join(process.env.LOCALAPPDATA ?? root, 'JustSayBuild', 'native')
const outDir = join(root, 'resources', 'native')

function findCmake() {
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (existsSync(vswhere)) {
    const install = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
    const cmake = join(install, 'Common7', 'IDE', 'CommonExtensions', 'Microsoft', 'CMake', 'CMake', 'bin', 'cmake.exe')
    if (install && existsSync(cmake)) return cmake
  }
  return 'cmake'
}

const cmake = findCmake()
const run = (args) => execFileSync(cmake, args, { stdio: 'inherit' })

mkdirSync(buildDir, { recursive: true })
run(['-S', nativeDir, '-B', buildDir, '-A', 'x64'])
run(['--build', buildDir, '--config', 'Release', '--parallel'])

mkdirSync(outDir, { recursive: true })
const binDir = join(buildDir, 'bin', 'Release')
for (const file of readdirSync(binDir).filter((f) => f.toLowerCase().endsWith('.dll'))) {
  copyFileSync(join(binDir, file), join(outDir, file))
  console.log(`copiado: resources/native/${file}`)
}
