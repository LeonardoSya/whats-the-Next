import { z } from 'zod'
import type { ToolDefinition } from '../types'

const MAX_PAGES = 50

const parameters = z.object({
  file_path: z.string().describe('PDF 文件的绝对路径'),
  pages: z
    .string()
    .optional()
    .describe('要提取的页码范围，如 "1-5" 或 "1,3,5"，默认全部（上限 50 页）'),
})

const PYTHON_SCRIPT = `
import sys, json
try:
    import PyPDF2
except ImportError:
    try:
        import pypdf as PyPDF2
    except ImportError:
        print(json.dumps({"error": "PyPDF2/pypdf not installed. Run: pip3 install pypdf"}))
        sys.exit(0)

data = json.loads(sys.argv[1])
path = data["file_path"]
pages_spec = data.get("pages")
max_pages = data.get("max_pages", 50)

reader = PyPDF2.PdfReader(path)
total = len(reader.pages)

if pages_spec:
    indices = set()
    for part in pages_spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            for i in range(int(a)-1, min(int(b), total)):
                indices.add(i)
        else:
            idx = int(part) - 1
            if 0 <= idx < total:
                indices.add(idx)
    page_indices = sorted(indices)[:max_pages]
else:
    page_indices = list(range(min(total, max_pages)))

extracted = []
for i in page_indices:
    text = reader.pages[i].extract_text() or ""
    extracted.append({"page": i + 1, "text": text})

print(json.dumps({
    "pages": extracted,
    "total_pages": total,
    "extracted_count": len(extracted),
}, ensure_ascii=False))
`

export const pdfExtractTool: ToolDefinition<typeof parameters> = {
  name: 'pdf_extract',
  description: 'Extract text content from a PDF file, optionally specifying page ranges.',
  parameters,
  riskLevel: 'safe',
  async execute(args) {
    const file = Bun.file(args.file_path)
    if (!(await file.exists())) throw new Error(`File not found: ${args.file_path}`)

    const payload = JSON.stringify({ ...args, max_pages: MAX_PAGES })
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
