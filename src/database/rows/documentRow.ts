export interface DocumentRow {
  id: number
  period_id: number
  type: string
  original_filename: string
  local_path: string
  sha256: string
  processing_status: string
  parser_version: string | null
  created_at: string
}
