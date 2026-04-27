export function OrthoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M 3.5 2 L 3.5 12.5 L 14 12.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="square"
      />
      <rect
        x="4"
        y="9"
        width="3.5"
        height="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}
