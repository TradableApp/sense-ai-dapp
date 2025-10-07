import { Outlet, useLocation } from 'react-router-dom';
import { ConnectButton } from 'thirdweb/react';

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import Separator from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { client, wallets } from '@/config/thirdweb';
import useConversations from '@/hooks/useConversations';
import useMobile from '@/hooks/useMobile';
import AppSidebar from '@/layouts/components/AppSidebar';
import MobileNav from '@/layouts/components/MobileNav';
import { cn } from '@/lib/utils';

function usePageTitle() {
	const location = useLocation();
	const path = location.pathname.split('/')[1];
	if (path === 'chat') return 'Chat';
	if (path === 'history') return 'History';
	return 'Market Pulse';
}
export default function MainLayout() {
	const pageTitle = usePageTitle();
	const isMobile = useMobile();

	// Centralized data fetching and polling for all conversation data.
	// This ensures polling works on mobile and avoids duplicate fetches.
	useConversations();

	return (
		// This parent div now controls the screen height for both layouts
		<div className={cn('flex h-screen bg-background', isMobile && 'flex-col')}>
			<SidebarProvider>
				{/* The AppSidebar is only rendered on non-mobile screens */}
				{!isMobile && <AppSidebar />}

				<SidebarInset
					className={cn(
						'bg-card',
						// On mobile, this becomes the main "card"
						isMobile
							? 'm-2 mb-20 flex-1 overflow-hidden rounded-xl border'
							: 'flex flex-1 flex-col overflow-hidden', // Use flex-1 to fill space, not h-screen
					)}
				>
					<header className="flex h-16 shrink-0 items-center gap-2 border-b">
						<div className="flex w-full items-center gap-2 px-4">
							{/* The trigger is hidden on mobile via CSS within the component */}
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

							{/* The Connect Button is only rendered in the header on mobile */}
							{isMobile && (
								<div className="ml-auto">
									<ConnectButton
										client={client}
										wallets={wallets}
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

				{/* The MobileNav (Dock) is only rendered on mobile screens */}
				{isMobile && <MobileNav />}
			</SidebarProvider>
		</div>
	);
}
