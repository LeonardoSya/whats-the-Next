import { z } from 'zod'
import type { ToolDefinition } from '../types'

const parameters = z.object({
  file_path: z.string().describe('输出 docx 文件的绝对路径'),
  content: z
    .array(
      z.object({
        type: z.enum(['heading', 'paragraph', 'table']).describe('内容块类型'),
        text: z.string().optional().describe('heading 或 paragraph 的文本内容'),
        level: z.number().int().min(1).max(9).optional().describe('heading 级别 (1-9)'),
        rows: z.array(z.array(z.string())).optional().describe('表格数据，二维数组，第一行为表头'),
      }),
    )
    .describe('文档内容块列表，按顺序排列'),
})

const PYTHON_SCRIPT = `
import sys, json
try:
    from docx import Document
except ImportError:
    print(json.dumps({"error": "python-docx not installed. Run: pip3 install python-docx"}))
    sys.exit(0)

data = json.loads(sys.argv[1])
path = data["file_path"]
blocks = data["content"]

doc = Document()
for block in blocks:
    t = block["type"]
    if t == "heading":
        doc.add_heading(block.get("text", ""), level=block.get("level", 1))
    elif t == "paragraph":
        doc.add_paragraph(block.get("text", ""))
    elif t == "table":
        rows = block.get("rows", [])
        if rows:
            table = doc.add_table(rows=len(rows), cols=len(rows[0]))
            for i, row in enumerate(rows):
                for j, cell in enumerate(row):
                    table.cell(i, j).text = cell

doc.save(path)
print(json.dumps({"ok": True, "file_path": path, "blocks": len(blocks)}, ensure_ascii=False))
`

export const docxWriteTool: ToolDefinition<typeof parameters> = {
  name: 'docx_write',
  description:
    'Create or overwrite a .docx Word document with structured content (headings, paragraphs, tables).',
  parameters,
  riskLevel: 'write',
  async execute(args) {
    const payload = JSON.stringify(args)
    const proc = Bun.spawn(['python3', '-c', PYTHON_SCRIPT, payload], {
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
