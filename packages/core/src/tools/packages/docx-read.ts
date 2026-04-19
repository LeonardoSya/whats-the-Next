import { z } from 'zod'
import type { ToolDefinition } from '../types'

const parameters = z.object({
  file_path: z.string().describe('docx 文件的绝对路径'),
})

const PYTHON_SCRIPT = `
import sys, json
try:
    from docx import Document
except ImportError:
    print(json.dumps({"error": "python-docx not installed. Run: pip3 install python-docx"}))
    sys.exit(0)

path = sys.argv[1]
doc = Document(path)
paragraphs = [p.text for p in doc.paragraphs]

tables = []
for table in doc.tables:
    rows = []
    for row in table.rows:
        rows.append([cell.text for cell in row.cells])
    tables.append(rows)

print(json.dumps({
    "paragraphs": paragraphs,
    "tables": tables,
    "paragraph_count": len(paragraphs),
    "table_count": len(tables),
}, ensure_ascii=False))
`

export const docxReadTool: ToolDefinition<typeof parameters> = {
  name: 'docx_read',
  description: 'Read a .docx Word document and extract its text content and tables.',
  parameters,
  riskLevel: 'safe',
  async execute({ file_path }) {
    const file = Bun.file(file_path)
    if (!(await file.exists())) throw new Error(`File not found: ${file_path}`)

    const proc = Bun.spawn(['python3', '-c', PYTHON_SCRIPT, file_path], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode !== 0) throw new Error(`python3 failed: ${stderr.trim()}`)

    return JSON.parse(stdout)
  },
}
