import Svg, { Path } from 'react-native-svg'

// Renders an @mdi/js path string.
export default function Icon({ path, size = 24, color = '#fff', style }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d={path} fill={color} />
    </Svg>
  )
}
