export function YinYangMark({
  className = "",
  variant = "brand",
}: {
  className?: string;
  variant?: "brand" | "separator";
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {variant === "separator" ? (
        <>
          <circle cx="50" cy="50" r="46" fill="currentColor" />
          <path
            d="M50 4a46 46 0 0 1 0 92 23 23 0 0 1 0-46 23 23 0 0 0 0-46Z"
            fill="var(--yin-yang-cutout, transparent)"
          />
          <circle
            cx="50"
            cy="27"
            r="7"
            fill="var(--yin-yang-cutout, transparent)"
          />
          <circle cx="50" cy="73" r="7" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="50" cy="50" r="46" fill="#171313" />
          <path
            d="M50 4a46 46 0 0 1 0 92 23 23 0 0 1 0-46 23 23 0 0 0 0-46Z"
            fill="#fff"
          />
          <circle cx="50" cy="27" r="7" fill="#fff" />
          <circle cx="50" cy="73" r="7" fill="#171313" />
          <circle cx="50" cy="50" r="46" stroke="#171313" strokeWidth="4" />
        </>
      )}
    </svg>
  );
}
