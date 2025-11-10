import { HelpCircle, LifeBuoy, Send } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { Outlet, useLocation } from 'react-router-dom';
import { ConnectButton } from 'thirdweb/react';

import ThemeToggle from '@/components/ThemeToggle';
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Separator from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { client, localChain, wallets } from '@/config/thirdweb';
import useConversations from '@/hooks/useConversations';
import useMobile from '@/hooks/useMobile';
import AppSidebar from '@/layouts/components/AppSidebar';
import MobileNav from '@/layouts/components/MobileNav';
import { cn } from '@/lib/utils';
import { openModal } from '@/store/uiSlice';

function usePageTitle() {
	const location = useLocation();
	const path = location.pathname.split('/')[1];
	if (path === 'chat') return 'Chat';
	if (path === 'history') return 'History';
	return 'Dashboard';
}
export default function MainLayout() {
	const pageTitle = usePageTitle();
	const isMobile = useMobile();
	const dispatch = useDispatch();

	useConversations();

	return (
		<div className={cn('flex h-screen bg-background', isMobile && 'flex-col')}>
			<SidebarProvider>
				{!isMobile && <AppSidebar />}

				<SidebarInset
					className={cn(
						'bg-card',
						isMobile
							? 'm-2 mb-20 flex-1 overflow-hidden rounded-xl border'
							: 'flex flex-1 flex-col overflow-hidden',
					)}
				>
					<header className="flex h-16 shrink-0 items-center gap-2 border-b">
						<div className="flex w-full items-center gap-2 px-4">
							{!isMobile && (
								<>
									<SidebarTrigger className="-ml-1" />
									<Separator orientation="vertical" className="mr-2 h-4" />
								</>
							)}
							<Breadcrumb>
								<BreadcrumbList>
									<BreadcrumbItem>
										<BreadcrumbPage>{pageTitle}</BreadcrumbPage>
									</BreadcrumbItem>
								</BreadcrumbList>
							</Breadcrumb>

							{isMobile && (
								<div className="ml-auto">
									<ConnectButton
										client={client}
										wallets={wallets}
										chains={[localChain]}
										appMetadata={{
											name: 'SenseAI App',
											url: 'https://tradable.app',
										}}
										theme="dark"
									/>
								</div>
							)}
						</div>
					</header>
					<main className="flex-1 overflow-y-auto p-4">
						<Outlet />
					</main>
				</SidebarInset>

				{isMobile && <MobileNav />}
			</SidebarProvider>

			{isMobile && (
				<>
					<div className="fixed bottom-4 left-4 z-50">
						<ThemeToggle />
					</div>

					<div className="fixed bottom-4 right-4 z-50">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="sm" className="rounded-full">
									<HelpCircle className="size-5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="mb-2">
								<DropdownMenuItem onClick={() => dispatch(openModal({ type: 'Support' }))}>
									<LifeBuoy className="mr-2 h-4 w-4" />
									<span>Support</span>
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => dispatch(openModal({ type: 'Feedback' }))}>
									<Send className="mr-2 h-4 w-4" />
									<span>Feedback</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</>
			)}
		</div>
	);
}
