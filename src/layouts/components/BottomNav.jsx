import { useMemo } from 'react';

import { BarChart2, History, MessageCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Dock, DockIcon } from '@/components/magicui/dock';

export default function BottomNav() {
	const location = useLocation();

	const pathnameMap = useMemo(
		() => ({
			'/': 'market',
			'/chat': 'chat',
			'/history': 'history',
		}),
		[],
	);

	const activeTab = pathnameMap[location.pathname] || 'market';

	return (
		<div className="fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center mb-2">
			<div className="pointer-events-auto">
				<Dock iconMagnification={60} iconDistance={100}>
					<DockIcon isActive={activeTab === 'market'}>
						<Link to="/">
							<BarChart2 className="size-7" />
						</Link>
					</DockIcon>
					<DockIcon isActive={activeTab === 'chat'}>
						<Link to="/chat">
							<MessageCircle className="size-7" />
						</Link>
					</DockIcon>
					<DockIcon isActive={activeTab === 'history'}>
						<Link to="/history">
							<History className="size-7" />
						</Link>
					</DockIcon>
				</Dock>
			</div>
		</div>
	);
}
