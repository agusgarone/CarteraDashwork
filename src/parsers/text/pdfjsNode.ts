import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export async function openPdf(data: Uint8Array) {
  return getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: assetUrl('standard_fonts'),
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
  }).promise
}

function assetUrl(folder: string): string {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('pdfjs-dist/package.json')
  const folderPath = path.join(path.dirname(packageJson), folder)
  const href = pathToFileURL(folderPath).href
  return href.endsWith('/') ? href : `${href}/`
}
