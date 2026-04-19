import { z } from 'zod'
import type { ToolDefinition } from '../types'

const parameters = z.object({
  file_path: z.string().describe('输出 xlsx 文件的绝对路径'),
  sheets: z
    .array(
      z.object({
        name: z.string().describe('工作表名称'),
        rows: z.array(z.array(z.string())).describe('行数据，二维字符串数组，第一行通常为表头'),
      }),
    )
    .describe('工作表列表'),
})

const PYTHON_SCRIPT = `
import sys, json
try:
    import openpyxl
except ImportError:
    print(json.dumps({"error": "openpyxl not installed. Run: pip3 install openpyxl"}))
    sys.exit(0)

data = json.loads(sys.argv[1])
path = data["file_path"]
sheets = data["sheets"]

wb = openpyxl.Workbook()
wb.remove(wb.active)

for sheet_data in sheets:
    ws = wb.create_sheet(title=sheet_data["name"])
    for row in sheet_data["rows"]:
        ws.append(row)

wb.save(path)
total_rows = sum(len(s["rows"]) for s in sheets)
print(json.dumps({
    "ok": True,
    "file_path": path,
    "sheets": len(sheets),
    "total_rows": total_rows,
}, ensure_ascii=False))
`

export const xlsxWriteTool: ToolDefinition<typeof parameters> = {
  name: 'xlsx_write',
  description: 'Create an Excel (.xlsx) file with one or more sheets of tabular data.',
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
