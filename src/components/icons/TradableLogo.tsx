import TradableLogoMonoSvg from '@/assets/tradable-logo-mono.svg?react';
import TradableLogoSvg from '@/assets/tradable-logo.svg?react';

interface TradableLogoProps {
	variant?: 'color' | 'monochrome';
	className?: string;
	[key: string]: any;
}

export default function TradableLogo({
	variant = 'color',
	className,
	...props
}: TradableLogoProps) {
	if (variant === 'monochrome') {
		// No fill color — inherits text color from parent via className
		return <TradableLogoMonoSvg className={className} aria-hidden="true" {...props} />;
	}

	return <TradableLogoSvg className={className} aria-hidden="true" {...props} />;
}
