import ExcelJS from 'exceljs'
import { fromBuffer } from 'yauzl'
import type { ImportRow } from '@electronic-club/shared'
import { ensure, memberSchema } from './model'
export const columns = ['学号', '姓名', '性别', '学院', '专业', '班级', '年级']
async function validateZip(buffer: Buffer) {
  ensure(buffer.length <= 2_000_000, 413, 'FILE_TOO_LARGE', '文件最大2MB')
  await new Promise<void>((resolve, reject) =>
    fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(new Error('无效的 XLSX 压缩文件'))
      let size = 0,
        count = 0,
        ended = false,
        actualSize = 0
      const fail = () => {
        if (!ended) {
          ended = true
          zip.close()
          reject(new Error('XLSX 解压数据过大或格式异常'))
        }
      }
      zip.on('error', fail)
      zip.on('entry', (entry) => {
        size += entry.uncompressedSize
        count++
        if (
          size > 20_000_000 ||
          count > 2000 ||
          entry.fileName.includes('..') ||
          entry.generalPurposeBitFlag & 1
        )
          fail()
        else
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
              fail()
              return
            }
            stream.on('data', (chunk) => {
              actualSize += chunk.length
              if (actualSize > 20_000_000) {
                stream.destroy()
                fail()
              }
            })
            stream.on('error', fail)
            stream.on('end', () => {
              if (!ended) zip.readEntry()
            })
          })
      })
      zip.on('end', () => {
        if (!ended) {
          ended = true
          resolve()
        }
      })
      zip.readEntry()
    }),
  )
}
export async function parseWorkbook(buffer: Buffer): Promise<ImportRow[]> {
  try {
    await validateZip(buffer)
  } catch {
    ensure(false, 400, 'INVALID_XLSX', '文件无效或解压体积超过20MB')
  }
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  } catch {
    ensure(false, 400, 'INVALID_XLSX', '无法解析XLSX文件')
  }
  const sheet = workbook.worksheets[0]
  ensure(sheet, 400, 'NO_SHEET', '文件没有工作表')
  ensure(
    columns.every(
      (name, index) => sheet.getRow(1).getCell(index + 1).text === name,
    ),
    400,
    'INVALID_COLUMNS',
    '表头须为：' + columns.join('、'),
  )
  ensure(
    sheet.rowCount <= 1001,
    413,
    'TOO_MANY_ROWS',
    '每文件最多1000行，请分文件导入',
  )
  const rows: ImportRow[] = []
  const seen = new Set<string>()
  for (let line = 2; line <= sheet.rowCount; line++) {
    const row = sheet.getRow(line)
    if (
      row.actualCellCount === 0 ||
      columns.every((_, i) => !row.getCell(i + 1).text.trim())
    )
      continue
    if (typeof row.getCell(1).value !== 'string') {
      rows.push({
        line,
        error:
          '学号必须为文本单元格；数字或科学计数法无法可靠恢复，请重新填写模板',
      })
      continue
    }
    const values: Record<string, string> = {}
    let invalid = false
    for (const [index, key] of [
      'studentId',
      'name',
      'gender',
      'college',
      'major',
      'className',
      'grade',
    ].entries()) {
      const cell = row.getCell(index + 1)
      if (typeof cell.value === 'object' && cell.value !== null) {
        invalid = true
        break
      }
      values[key] = key === 'studentId' ? cell.text : cell.text.trim()
    }
    if (invalid) {
      rows.push({ line, error: '不支持公式、超链接或富文本单元格' })
      continue
    }
    if (!values.gender) values.gender = '未填写'
    const parsed = memberSchema.safeParse(values)
    if (!parsed.success) {
      rows.push({
        line,
        error: parsed.error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('；'),
      })
      continue
    }
    const member = {
      studentId: parsed.data.studentId,
      name: parsed.data.name,
      gender: parsed.data.gender,
      college: parsed.data.college,
      major: parsed.data.major,
      className: parsed.data.className,
      grade: parsed.data.grade,
    }
    const duplicate = seen.has(member.studentId)
    seen.add(member.studentId)
    rows.push({
      line,
      member,
      ...(duplicate ? { error: '文件内学号重复' } : {}),
    })
  }
  ensure(rows.length > 0, 400, 'EMPTY_FILE', '没有可导入的数据行')
  return rows
}
export async function templateWorkbook() {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('成员导入')
  sheet.addRow(columns)
  sheet.getColumn(1).numFmt = '@'
  sheet.columns.forEach((column) => {
    column.width = 22
  })
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  return Buffer.from(await book.xlsx.writeBuffer())
}

export async function exportWorkbook(headers: string[], rows: string[][]) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('数据')
  sheet.addRow(headers)
  sheet.columns = headers.map(() => ({ width: 24, style: { numFmt: '@' } }))
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await book.xlsx.writeBuffer())
}
