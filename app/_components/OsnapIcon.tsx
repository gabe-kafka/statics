export function OsnapIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="6"
        y="6"
        width="8"
        height="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <rect
        x="3.5"
        y="3.5"
        width="5"
        height="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}
