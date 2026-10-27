import type { HTMLAttributes } from 'react';

import { BarChart2, History, LifeBuoy, MessageCircle, Send } from 'lucide-react';

import senseaiLogo from '@/assets/logos/senseai-logo.svg';
import { Separator } from '@/components/ui/separator';
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

const navData = {
	main: [
		{ title: 'Dashboard', url: '/', icon: BarChart2 },
		{ title: 'Chat', url: '/chat', icon: MessageCircle },
		{ title: 'History', url: '/history', icon: History, hasChildren: true },
	],
	secondary: [
		{ title: 'Support', url: '#', icon: LifeBuoy },
		{ title: 'Feedback', url: '#', icon: Send },
	],
};

interface AppSidebarProps extends HTMLAttributes<HTMLDivElement> {}

export default function AppSidebar(props: AppSidebarProps) {
	return (
		<Sidebar variant="inset" className="flex flex-col h-screen" {...props}>
			<SidebarHeader className="shrink-0">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<a href="/">
								<img src={senseaiLogo} alt="SenseAI Logo" className="size-8 shrink-0" />
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-semibold">SenseAI</span>
									<span className="truncate text-xs">Agent</span>
								</div>
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			{/* This content area grows and pushes the footer down */}
			<SidebarContent>
				<NavMain items={navData.main} />

				{/* This div uses mt-auto to pin itself to the bottom of the flex container */}
				<div className="mt-auto">
					<Separator className="my-2" />
					<NavSecondary items={navData.secondary} />
				</div>
			</SidebarContent>

			<SidebarFooter className="shrink-0">
				<NavUser />
			</SidebarFooter>
		</Sidebar>
	);
}
