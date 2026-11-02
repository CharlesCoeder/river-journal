import { memo, type JSX } from 'react'
import { Svg, Circle, Path, type SvgProps } from 'react-native-svg'
import { themed, type IconProps } from '@tamagui/helpers-icon'

export const Users: (props: IconProps) => JSX.Element = themed(
  memo(function Users(props: IconProps) {
    const { color = 'black', size = 24, ...otherProps } = props as SvgProps & {
      color?: string
      size?: number
    }
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...otherProps}
      >
        <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke={color} />
        <Path d="M16 3.128a4 4 0 0 1 0 7.744" stroke={color} />
        <Path d="M22 21v-2a4 4 0 0 0-3-3.87" stroke={color} />
        <Circle cx="9" cy="7" r="4" stroke={color} />
      </Svg>
    )
  })
)
