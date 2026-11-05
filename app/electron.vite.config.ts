import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Processo Node filho que segura o hook de teclado.
          'keyboard-child': resolve('src/main/keyboard/child.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // CJS para o preload rodar com sandbox ligado.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          'floating-bar': resolve('src/renderer/floating-bar.html'),
          hub: resolve('src/renderer/hub.html'),
          'copy-card': resolve('src/renderer/copy-card.html'),
          'answer-card': resolve('src/renderer/answer-card.html'),
        },
      },
    },
  },
})
