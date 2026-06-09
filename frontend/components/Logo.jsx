import Image from 'next/image';

export default function Logo({ height, size, withName = false, nameClass = '', style = {} }) {
  const h = height ?? size ?? 40;
  const width = Math.round(h * (1408 / 768));
  return (
    <span className="flex items-center gap-2.5">
      <Image
        src="/logo.png"
        alt="RESUMATE"
        width={width}
        height={h}
        priority
        style={{ height: h, width: 'auto', objectFit: 'contain', ...style }}
      />
      {withName && (
        <span className={nameClass || 'font-bold text-slate-900 dark:text-white text-sm tracking-wide'}>
          RESUMATE
        </span>
      )}
    </span>
  );
}
