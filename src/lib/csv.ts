// Exporta filas a un archivo CSV (UTF-8 con BOM para que Excel lea las tildes)
export function descargarCsv(nombre: string, filas: Record<string, unknown>[]) {
  if (filas.length === 0) return
  const columnas = Object.keys(filas[0]!)
  const celda = (v: unknown) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join(' | ') : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const texto = [columnas.join(';'), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(';'))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }))
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
