import { useMemo } from 'react';

import { BarChart2, History, MessageCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Dock, DockIcon } from '@/components/magicui/dock';

const navItems = [
	{ title: 'Market', url: '/', icon: BarChart2 },
	{ title: 'Chat', url: '/chat', icon: MessageCircle },
	{ title: 'History', url: '/history', icon: History },
];

export default function MobileNav() {
	const location = useLocation();

	const activeTab = useMemo(() => {
		const currentPath = location.pathname;
		if (currentPath === '/chat') return 'Chat';
		if (currentPath === '/history') return 'History';
		return 'Market';
	}, [location.pathname]);

	return (
		// The 'm-2' class provides equal margin on all sides, matching the container above.
		<div className="md:hidden fixed bottom-0 left-0 right-0 z-50 pointer-events-none flex justify-center m-2">
			<div className="pointer-events-auto">
				<Dock iconMagnification={60} iconDistance={100}>
					{navItems.map(item => (
						<DockIcon key={item.title} isActive={activeTab === item.title}>
							<Link to={item.url}>
								<item.icon className="size-7" />
							</Link>
						</DockIcon>
					))}
				</Dock>
			</div>
		</div>
	);
}
