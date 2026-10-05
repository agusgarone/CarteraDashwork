/// <reference types="vitest/config" />
import path from 'node:path'
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss(), copyPdfjsAssets(root)],
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

function copyPdfjsAssets(root: string): Plugin {
  const copy = () => {
    const source = path.resolve(root, 'node_modules/pdfjs-dist')
    const target = path.resolve(root, 'public/pdfjs')
    mkdirSync(target, { recursive: true })
    cpSync(path.join(source, 'standard_fonts'), path.join(target, 'standard_fonts'), { recursive: true })
    cpSync(path.join(source, 'cmaps'), path.join(target, 'cmaps'), { recursive: true })
  }
  return {
    name: 'pdfjs-assets',
    buildStart: copy,
    configureServer: copy,
  }
}
