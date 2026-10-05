import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

let workerReady = false

export async function openPdf(data: Uint8Array) {
  if (!workerReady) {
    GlobalWorkerOptions.workerSrc = workerUrl
    workerReady = true
  }
  const base = import.meta.env.BASE_URL
  return getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
  }).promise
}
