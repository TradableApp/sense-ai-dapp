import { FunctionComponent, SVGProps } from 'react';

// SVGs are imported dynamically by vite-plugin-svgr
// TypeScript needs these declarations to understand the ?react query string
const TradableLogoMonoSvg: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }> = require('@/assets/tradable-logo-mono.svg?react').default;
const TradableLogoSvg: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }> = require('@/assets/tradable-logo.svg?react').default;

interface TradableLogoProps {
	variant?: 'color' | 'monochrome';
	className?: string;
	[key: string]: any;
}

/**
 * A flexible component to display the Tradable logo.
 * It can render either the full-color version or a theme-aware monochrome version.
 * @param {object} props - Standard React component props.
 * @param {'color' | 'monochrome'} [props.variant='color'] - The version of the logo to display.
 */
export default function TradableLogo({ variant = 'color', className, ...props }: TradableLogoProps) {
	if (variant === 'monochrome') {
		// The monochrome version has no fill color, so it will inherit the text color
		// from its parent, applied via the `className`.
		return <TradableLogoMonoSvg className={className} aria-hidden="true" {...props} />;
	}

	// The color version has its own internal gradients and will not be affected by `className` color.
	return <TradableLogoSvg className={className} aria-hidden="true" {...props} />;
}
