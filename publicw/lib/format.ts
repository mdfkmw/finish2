export function formatRoDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return value
    }
    return date.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return value || '—'
  }
}

export function formatPrice(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || Number.isNaN(Number(value)) || value <= 0) {
    return '-'
  }

  try {
    return new Intl.NumberFormat('ro-RO', {
      style: 'currency',
      currency: currency || 'RON',
      minimumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${value} ${currency || 'RON'}`
  }
}
