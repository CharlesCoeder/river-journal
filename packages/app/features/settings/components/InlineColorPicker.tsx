import Sketch from '@uiw/react-color-sketch'

export function InlineColorPicker({
  color,
  onChange,
}: {
  color: string
  onChange: (hex: string) => void
}) {
  return (
    <Sketch
      color={color}
      presetColors={false}
      onChange={(c) => onChange(c.hex)}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        borderRadius: 12,
        boxShadow: 'none',
        border: '1px solid var(--color5, #e0e0e0)',
        fontFamily: 'Outfit, sans-serif',
      }}
    />
  )
}
