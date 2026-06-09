import Image from 'next/image';

export default function Logo({ height = 40, style = {} }) {
  const width = Math.round(height * (1408 / 768));
  return (
    <Image
      src="/logo.png"
      alt="RESUMATE"
      width={width}
      height={height}
      priority
      style={{ height, width: 'auto', objectFit: 'contain', ...style }}
    />
  );
}
