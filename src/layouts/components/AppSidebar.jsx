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
import NavSecondary from '@/layouts/components/nav/NavSecondary';
import NavUser from '@/layouts/components/nav/NavUser';
import senseaiLogo from '@/senseai-logo.svg';

const navData = {
	main: [
		{ title: 'Market', url: '/', icon: BarChart2 },
		{ title: 'Chat', url: '/chat', icon: MessageCircle },
		{ title: 'History', url: '/history', icon: History, hasChildren: true },
	],
	secondary: [
		{ title: 'Support', url: '#', icon: LifeBuoy },
		{ title: 'Feedback', url: '#', icon: Send },
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
