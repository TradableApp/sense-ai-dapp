import { BarChart2, History, LifeBuoy, MessageCircle, Send } from 'lucide-react';

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import NavMain from '@/layouts/components/nav/NavMain';
import NavSecondary from '@/layouts/components/nav/NavSecondary'; // We will create this
import NavUser from '@/layouts/components/nav/NavUser';
import senseaiLogo from '@/senseai-logo.svg';

// 1. Add mock data for the recent history items.
const recentHistory = [
	{ id: '1', title: 'SenseAI dApp UI/UX Review', url: '#' },
	{ id: '2', title: 'Bitcoin On-Chain Analysis', url: '#' },
	{ id: '3', title: 'Ethereum EIP-7702 Impact', url: '#' },
	{ id: '4', title: 'Market Sentiment Check', url: '#' },
	{ id: '5', title: 'Tokenomics Review', url: '#' },
];

const navData = {
	main: [
		{
			title: 'Market',
			url: '/',
			icon: BarChart2,
		},
		{
			title: 'Chat',
			url: '/chat',
			icon: MessageCircle,
		},
		{
			title: 'History',
			url: '/history',
			icon: History,
			// 2. Add the recent history data as children to the History nav item.
			children: recentHistory,
		},
	],
	secondary: [
		{
			title: 'Support',
			url: '#', // Replace with your support link
			icon: LifeBuoy,
		},
		{
			title: 'Feedback',
			url: '#', // Replace with your feedback link
			icon: Send,
		},
	],
};

export default function AppSidebar(props) {
	return (
		<Sidebar variant="inset" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<a href="/">
								<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary-foreground text-primary-foreground">
									<img src={senseaiLogo} alt="SenseAI Logo" className="size-4" />
								</div>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-semibold">SenseAI</span>
									<span className="truncate text-xs">Agent</span>
								</div>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={navData.main} />
				<NavSecondary items={navData.secondary} className="mt-auto" />
			</SidebarContent>
			<SidebarFooter>
				<NavUser />
			</SidebarFooter>
		</Sidebar>
	);
}
