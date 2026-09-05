/** The one piece of branding, so replacing it is a single-file change. */
export default function BrandMark({ size = 32 }: { readonly size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <path
          d="M12 2.5 4 7v10l8 4.5 8-4.5V7l-8-4.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M12 11.5 4 7m8 4.5L20 7m-8 4.5V21" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}
