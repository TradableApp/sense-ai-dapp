import { useState } from 'react';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import useConversations from '@/hooks/useConversations';
import { cn } from '@/lib/utils';
import { setActiveConversationId } from '@/store/chatSlice';

export default function NavMain({ items }) {
	const location = useLocation();
	const navigate = useNavigate();
	const dispatch = useDispatch();
	const [isHistoryOpen, setIsHistoryOpen] = useState(true);

	const activeConversationId = useSelector(state => state.chat.activeConversationId);

	const { data: allConversations } = useConversations();

	const handleSelectConversation = conversationId => {
		console.log(
			`%c[NavMain.jsx-LOG] handleSelectConversation clicked for ID: ${conversationId}. Dispatching setActiveConversationId.`,
			'color: orange; font-weight: bold;',
		);
		dispatch(setActiveConversationId(conversationId));
		navigate('/chat');
	};

	return (
		// This group must be a flex container that can grow and manage its children's height.
		<SidebarGroup className="flex-grow flex flex-col min-h-0">
			<SidebarGroupLabel>Platform</SidebarGroupLabel>
			{/* This menu is now the master layout container for the navigation items */}
			<SidebarMenu className="flex flex-col flex-grow min-h-0">
				{items.map(item =>
					item.hasChildren && allConversations && allConversations.length > 0 ? (
						// The Collapsible for "History" is the ONLY element that grows.
						// min-h-0 is critical to allow its child to scroll within its flex boundary.
						<Collapsible
							key={item.title}
							open={isHistoryOpen}
							onOpenChange={setIsHistoryOpen}
							className="flex flex-col flex-grow min-h-0"
						>
							{/* The trigger part of the history item does NOT grow. */}
							<SidebarMenuItem className="!p-0 shrink-0">
								<div className="group flex w-full items-center">
									<SidebarMenuButton
										asChild
										tooltip={item.title}
										isActive={location.pathname.startsWith(item.url)}
										className="flex-1"
									>
										<Link to={item.url}>
											<item.icon />
											<span>{item.title}</span>
										</Link>
									</SidebarMenuButton>
									<CollapsibleTrigger
										className={cn(
											'ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full group-hover:bg-sidebar-accent group-hover:text-sidebar-accent-foreground',
											(location.pathname.startsWith(item.url) || isHistoryOpen) &&
												'bg-sidebar-accent text-sidebar-accent-foreground',
										)}
									>
										{isHistoryOpen ? (
											<ChevronUp className="h-4 w-4" />
										) : (
											<ChevronDown className="h-4 w-4" />
										)}
										<span className="sr-only">Toggle history</span>
									</CollapsibleTrigger>
								</div>
							</SidebarMenuItem>

							{/* This content area is the ONLY scrollable element. */}
							<CollapsibleContent className="overflow-y-auto">
								<ul className="space-y-1 px-4 py-2">
									{allConversations.map(child => (
										<li key={child.id}>
											<button
												type="button"
												onClick={() => handleSelectConversation(child.id)}
												className={cn(
													'w-full text-left block truncate rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
													location.pathname === '/chat' &&
														child.id === activeConversationId &&
														'bg-sidebar-accent text-sidebar-accent-foreground',
												)}
											>
												{child.title}
											</button>
										</li>
									))}
								</ul>
							</CollapsibleContent>
						</Collapsible>
					) : (
						// All other menu items (Dashboard, Chat) do NOT grow.
						<SidebarMenuItem key={item.title} className="shrink-0">
							<SidebarMenuButton
								asChild
								tooltip={item.title}
								isActive={location.pathname === item.url}
							>
								<Link to={item.url}>
									<item.icon />
									<span>{item.title}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					),
				)}
			</SidebarMenu>
		</SidebarGroup>
	);
}
