/**
 * RESUMATE brand logo — document/form icon with gradient background.
 * Usage:
 *   <Logo size={32} />                  — icon only
 *   <Logo size={32} withName />         — icon + "RESUMATE" text
 *   <Logo size={32} withName nameClass="text-lg" />
 */
export default function Logo({ size = 32, withName = false, nameClass = '' }) {
  // Scale the inner shapes proportionally to any icon size
  const s = size / 40;

  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="RESUMATE logo"
      >
        <defs>
          <linearGradient
            id="rm-bg"
            x1="0" y1="0" x2="40" y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%"   stopColor="#4338CA" />
            <stop offset="100%" stopColor="#6D28D9" />
          </linearGradient>
          <linearGradient
            id="rm-shine"
            x1="0" y1="0" x2="0" y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Rounded-square background */}
        <rect width="40" height="40" rx="9" fill="url(#rm-bg)" />
        {/* Subtle top-shine for depth */}
        <rect width="40" height="40" rx="9" fill="url(#rm-shine)" />

        {/* Document body */}
        <path
          d="M9 5h16l8 8v22H9V5z"
          fill="white"
          fillOpacity="0.17"
        />
        {/* Dog-ear fold */}
        <path
          d="M25 5l8 8h-8V5z"
          fill="white"
          fillOpacity="0.32"
        />
        {/* Fold crease line */}
        <line x1="25" y1="13" x2="33" y2="13" stroke="white" strokeOpacity="0.18" strokeWidth="0.6" />

        {/* ── Form field 1 ── */}
        {/* Label stub */}
        <rect x="13" y="16" width="6"  height="1.4" rx="0.7" fill="white" fillOpacity="0.45" />
        {/* Input bar */}
        <rect x="13" y="18.6" width="15" height="2.6" rx="1.3" fill="white" />

        {/* ── Form field 2 ── */}
        {/* Label stub */}
        <rect x="13" y="23.4" width="6"  height="1.4" rx="0.7" fill="white" fillOpacity="0.45" />
        {/* Input bar */}
        <rect x="13" y="26"   width="11" height="2.6" rx="1.3" fill="white" fillOpacity="0.82" />
      </svg>

      {withName && (
        <span
          className={
            nameClass ||
            'font-bold tracking-widest text-slate-900 dark:text-white'
          }
          style={{ letterSpacing: '0.12em' }}
        >
          RESUMATE
        </span>
      )}
    </div>
  );
}
