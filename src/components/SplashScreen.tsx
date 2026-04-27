import rocketWebm from '@/assets/animation/rocket-splash-300kb.webm';
import rocketMp4 from '@/assets/animation/rocket-splash-blue-background.mp4';

export default function SplashScreen() {
	const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

	return (
		<div
			className="splash-screen-background"
			style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
		>
			<video preload="auto" autoPlay playsInline muted loop>
				{isSafari ? (
					<source src={rocketMp4} type="video/mp4" />
				) : (
					<>
						<source src={rocketWebm} type="video/webm" />
						<source src={rocketMp4} type='video/mp4; codecs="hvc1"' />
					</>
				)}
			</video>
		</div>
	);
}
