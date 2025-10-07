/**
 * A reusable SVG component for the X (formerly Twitter) logo.
 * It uses `fill="currentColor"` to inherit its color from parent CSS text color,
 * allowing it to be styled easily with Tailwind's text color utilities.
 * @param {object} props - Standard React component props (e.g., className).
 */
export default function XLogo({ className, ...props }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 1200 1227"
			fill="currentColor"
			className={className}
			aria-hidden="true" // It's decorative within an anchor tag, which has its own aria-label
			{...props}
		>
			<path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6902H306.615L611.412 515.685L658.88 583.579L1076.55 1156.31H913.946L569.165 687.854V687.828Z" />
		</svg>
	);
}
