import { z } from 'zod'
import type { ToolDefinition } from '../types'

const MAX_ROWS = 500

const parameters = z.object({
  file_path: z.string().describe('xlsx 或 csv 文件的绝对路径'),
  sheet: z.string().optional().describe('工作表名称（仅 xlsx），默认第一个'),
  max_rows: z.number().int().positive().optional().describe(`最大读取行数，默认 ${MAX_ROWS}`),
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
sheet_name = data.get("sheet")
max_rows = data.get("max_rows", 500)

if path.endswith(".csv"):
    import csv
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = []
        for i, row in enumerate(reader):
            if i >= max_rows:
                break
            rows.append(row)
    print(json.dumps({
        "rows": rows,
        "row_count": len(rows),
        "sheet": "csv",
    }, ensure_ascii=False))
else:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet_name] if sheet_name else wb.active
    sheet_names = wb.sheetnames
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i >= max_rows:
            break
        rows.append([str(c) if c is not None else "" for c in row])
    wb.close()
    print(json.dumps({
        "rows": rows,
        "row_count": len(rows),
        "sheet": ws.title,
        "all_sheets": sheet_names,
    }, ensure_ascii=False))
`

export const xlsxReadTool: ToolDefinition<typeof parameters> = {
  name: 'xlsx_read',
  description: 'Read an Excel (.xlsx) or CSV file and return rows as a 2D array.',
  parameters,
  riskLevel: 'safe',
  async execute(args) {
    const payload = JSON.stringify({ ...args, max_rows: args.max_rows ?? MAX_ROWS })
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
