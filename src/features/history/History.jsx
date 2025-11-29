import { useEffect, useMemo, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import {
	FilePenLine,
	Loader2,
	MessageSquare,
	MoreHorizontal,
	PlusCircle,
	Search,
	Trash2,
} from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import EmptyState from '@/components/ui/empty-state';
import Input from '@/components/ui/input';
import Skeleton from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/features/auth/SessionProvider';
import useChatMutations from '@/hooks/useChatMutations';
import useConversations from '@/hooks/useConversations';
import useUsagePlan from '@/hooks/useUsagePlan';
import { deleteConversation, renameConversation } from '@/lib/dataService';
import { initializeSearch, search, teardownSearch } from '@/lib/searchService';
import { markdownToPlainText } from '@/lib/utils';
import {
	clearActiveConversation,
	closeRenameModal,
	openRenameModal,
	setActiveConversationId,
} from '@/store/chatSlice';

import RenameConversationModal from './RenameConversationModal';

export default function History() {
	const navigate = useNavigate();
	const dispatch = useDispatch();
	const queryClient = useQueryClient();
	const { sessionKey, ownerAddress } = useSession();
	const { data: plan } = useUsagePlan();
	const hasActivePlan = !!plan;

	const { metadataUpdateMutation } = useChatMutations();
	const { isRenameModalOpen, conversationToRename } = useSelector(state => state.chat);
	const activeConversationId = useSelector(state => state.chat.activeConversationId);

	const [searchQuery, setSearchQuery] = useState('');
	const [filteredConversationIds, setFilteredConversationIds] = useState(null);
	const [isAlertOpen, setIsAlertOpen] = useState(false);
	const [conversationToDelete, setConversationToDelete] = useState(null);

	const skeletonKeys = useMemo(() => Array.from({ length: 3 }, () => `skel-${Math.random()}`), []);
	const isSessionReady = !!sessionKey && !!ownerAddress;

	const { data: conversations, isLoading, isError } = useConversations();

	useEffect(() => {
		if (isSessionReady) {
			initializeSearch(sessionKey, ownerAddress);
		}
		return () => {
			teardownSearch();
		};
	}, [sessionKey, ownerAddress, isSessionReady]);

	const confirmDelete = () => {
		if (!conversationToDelete) {
			return;
		}

		const conversation = conversations.find(c => c.id === conversationToDelete);

		if (!conversation) {
			return;
		}

		metadataUpdateMutation.mutate(
			{
				conversationId: conversationToDelete,
				isDeleted: true,
				title: conversation.title,
				sessionKey,
			},
			{
				onSuccess: async () => {
					await deleteConversation(sessionKey, ownerAddress, conversationToDelete, queryClient);

					toast.success('Conversation deleted.');

					if (activeConversationId === conversationToDelete) {
						dispatch(clearActiveConversation());
					}

					setIsAlertOpen(false);
					setConversationToDelete(null);
				},
				// onError: () => {},
			},
		);
	};

	const handleRenameSubmit = newTitle => {
		if (!conversationToRename) return;
		metadataUpdateMutation.mutate(
			{
				conversationId: conversationToRename.id,
				title: newTitle,
				isDeleted: false,
				sessionKey,
			},
			{
				onSuccess: async () => {
					await renameConversation(
						sessionKey,
						ownerAddress,
						{ id: conversationToRename.id, newTitle },
						queryClient,
					);

					dispatch(closeRenameModal());
				},
				// Let the modal itself display the error passed via props
				// onError: () => {},
			},
		);
	};

	const handleRenameClick = (e, conversation) => {
		e.stopPropagation();

		dispatch(openRenameModal({ id: conversation.id, title: conversation.title }));
	};

	const handleDeleteClick = (e, conversationId) => {
		e.stopPropagation();

		setConversationToDelete(conversationId);
		setIsAlertOpen(true);
	};

	const handleSelectConversation = conversationId => {
		dispatch(setActiveConversationId(conversationId));
		navigate('/chat');
	};

	const displayedConversations = useMemo(() => {
		if (!conversations) {
			return [];
		}

		if (filteredConversationIds === null) {
			return conversations;
		}

		const filteredSet = new Set(filteredConversationIds);

		return conversations.filter(c => filteredSet.has(c.id));
	}, [conversations, filteredConversationIds]);

	const handleSearchChange = e => {
		const query = e.target.value;
		setSearchQuery(query);

		if (query.trim() === '') {
			setFilteredConversationIds(null);
		} else {
			const results = search(query);
			setFilteredConversationIds(results);
		}
	};

	const hasConversations = !isLoading && conversations && conversations.length > 0;
	const showEmptyState = !isLoading && (!conversations || conversations.length === 0);
	const showNoResults =
		!isLoading &&
		searchQuery.trim() !== '' &&
		filteredConversationIds &&
		filteredConversationIds.length === 0;

	return (
		<>
			<RenameConversationModal
				open={isRenameModalOpen}
				onOpenChange={isOpen => !isOpen && dispatch(closeRenameModal())}
				onRenameSubmit={handleRenameSubmit}
				isProcessing={metadataUpdateMutation.isPending}
				error={metadataUpdateMutation.error}
				conversationToRename={conversationToRename}
			/>
			<div className="flex flex-col gap-4">
				<div>
					<h2 className="text-2xl font-bold">Conversations</h2>
					<p className="text-muted-foreground">
						Select a conversation to continue where you left off.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
						<Input
							type="search"
							placeholder="Search history..."
							className="w-full rounded-lg bg-background pl-8"
							value={searchQuery}
							onChange={handleSearchChange}
						/>
					</div>
					<Button
						asChild
						className="items-center gap-1"
						onClick={() => dispatch(clearActiveConversation())}
					>
						<Link to="/chat">
							<PlusCircle className="size-3.5" />
						</Link>
					</Button>
				</div>
				<div className="overflow-hidden rounded-xl border">
					{hasConversations && (
						<div className="hidden items-center border-b bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground md:flex">
							<div className="flex-1">Name</div>
							<div className="flex-1">Preview</div>
							<div className="w-32 flex-shrink-0 text-right">Updated</div>
							<div className="w-10 flex-shrink-0" />
						</div>
					)}
					<div>
						{isLoading &&
							skeletonKeys.map(key => (
								<div key={key} className="flex items-center gap-3 border-b p-4">
									<Skeleton className="size-5" />
									<div className="flex-1 min-w-0">
										<Skeleton className="h-4 w-3/4" />
									</div>
								</div>
							))}
						{isError && <div className="p-4 text-destructive">Error loading conversations.</div>}
						{showEmptyState && <EmptyState />}
						{showNoResults && (
							<div className="p-4 text-center text-muted-foreground">No results found.</div>
						)}
						{hasConversations &&
							!showNoResults &&
							displayedConversations.map(item => {
								const displayDate = item.lastMessageCreatedAt || item.createdAt;
								return (
									<div
										key={item.id}
										role="button"
										tabIndex={0}
										className="w-full text-left flex items-center gap-3 border-b p-4 text-sm last:border-b-0 cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										onClick={() => handleSelectConversation(item.id)}
										onKeyDown={e => {
											if (e.key === 'Enter' || e.key === ' ') {
												handleSelectConversation(item.id);
											}
										}}
									>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-3">
												<MessageSquare className="size-5 flex-shrink-0 text-muted-foreground" />
												<p className="font-medium truncate">{item.title}</p>
											</div>

											<p className="mt-1 hidden truncate text-muted-foreground md:block">
												{markdownToPlainText(item.lastMessagePreview)}
											</p>

											<div className="md:hidden mt-1">
												<p className="truncate text-xs text-muted-foreground">
													{markdownToPlainText(item.lastMessagePreview)}
												</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{new Date(displayDate).toLocaleDateString()}
												</p>
											</div>
										</div>

										<div className="hidden w-32 flex-shrink-0 text-right text-muted-foreground md:block">
											{new Date(displayDate).toLocaleDateString()}
										</div>

										<div className="flex-shrink-0">
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														aria-haspopup="true"
														size="icon"
														variant="ghost"
														onClick={e => e.stopPropagation()}
														disabled={!isSessionReady}
													>
														<MoreHorizontal className="size-4" />
														<span className="sr-only">Toggle menu</span>
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
													<TooltipProvider>
														<Tooltip>
															<TooltipTrigger asChild>
																<div className="w-full">
																	<DropdownMenuItem
																		disabled={!hasActivePlan}
																		onClick={e => hasActivePlan && handleRenameClick(e, item)}
																	>
																		<FilePenLine className="mr-2 size-4" />
																		Rename
																	</DropdownMenuItem>
																</div>
															</TooltipTrigger>
															{!hasActivePlan && (
																<TooltipContent>
																	<p>You must have an active plan to rename.</p>
																</TooltipContent>
															)}
														</Tooltip>
														<Tooltip>
															<TooltipTrigger asChild>
																<div className="w-full">
																	<DropdownMenuItem
																		className="text-destructive"
																		disabled={!hasActivePlan}
																		onClick={e => hasActivePlan && handleDeleteClick(e, item.id)}
																	>
																		<Trash2 className="mr-2 size-4" />
																		Delete
																	</DropdownMenuItem>
																</div>
															</TooltipTrigger>
															{!hasActivePlan && (
																<TooltipContent>
																	<p>You must have an active plan to delete.</p>
																</TooltipContent>
															)}
														</Tooltip>
													</TooltipProvider>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									</div>
								);
							})}
					</div>
				</div>
			</div>
			<AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this conversation. This action requires a transaction and
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => setConversationToDelete(null)}
							disabled={metadataUpdateMutation.isPending}
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive hover:bg-destructive/90"
							onClick={confirmDelete}
							disabled={metadataUpdateMutation.isPending}
						>
							{metadataUpdateMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
							Continue
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
