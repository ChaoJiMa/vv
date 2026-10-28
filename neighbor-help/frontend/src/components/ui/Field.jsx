export default function Field({
  label,
  error,
  as = 'input',
  style,
  className = '',
  ...rest
}) {
  const Comp = as
  return (
    <label style={{ display: 'block', width: '100%', textAlign: 'left', ...style }} className={className}>
      {label ? (
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          {label}
        </span>
      ) : null}
      <Comp
        {...rest}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          minHeight: as === 'textarea' ? 96 : 44,
          padding: '10px 14px',
          borderRadius: 'var(--radius-btn)',
          border: `1.5px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          fontSize: 15,
          outline: 'none',
          resize: as === 'textarea' ? 'vertical' : undefined,
          ...(rest.style || {}),
        }}
      />
      {error ? (
        <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: 'var(--color-danger)' }}>
          {error}
        </span>
      ) : null}
    </label>
  )
}
