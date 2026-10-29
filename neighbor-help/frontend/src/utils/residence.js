/** 只保留数字（楼栋 / 房号录入用） */
export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * 展示住址：纯数字拼「栋」「号」；旧数据（含文字）原样拼接。
 * 例：3 + 501 →「3栋501号」
 */
export function formatResidence(building, unit) {
  const b = String(building ?? '').trim()
  const u = String(unit ?? '').trim()
  const bNum = /^\d+$/.test(b)
  const uNum = /^\d+$/.test(u)
  if (bNum && uNum) return `${b}栋${u}号`
  if (bNum && !u) return `${b}栋`
  if (!b && uNum) return `${u}号`
  if (bNum && u) return `${b}栋${u}`
  return [b, u].filter(Boolean).join(' ')
}
