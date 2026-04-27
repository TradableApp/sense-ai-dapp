import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { GraphQLClient } from 'graphql-request';
import {
	Activity,
	Ban,
	FilePenLine,
	MessageCircle,
	RotateCcw,
	ShieldCheck,
	ShieldOff,
	Split,
	Trash2,
} from 'lucide-react';
import { formatEther } from 'viem';

import { useSession } from '@/features/auth/SessionProvider';
import { GET_RECENT_ACTIVITY_QUERY } from '@/lib/graph/queries';
import type {
	GetRecentActivityQuery,
	GetRecentActivityQueryVariables,
} from '@/lib/graph/query-types';

const THE_GRAPH_API_URL = import.meta.env.VITE_THE_GRAPH_API_URL;
const graphQLClient = new GraphQLClient(THE_GRAPH_API_URL);

// Map activity types from The Graph to UI elements
const activityTypeMap = {
	// UPDATED: Combined PROMPT/REGENERATE into CONVERSATION
	CONVERSATION: { label: 'AI Conversation', icon: MessageCircle },
	RENAME: { label: 'Conversation Renamed', icon: FilePenLine }, // Matches Subgraph logic
	DELETE: { label: 'Conversation Deleted', icon: Trash2 }, // Matches Subgraph logic (via Metadata)
	METADATA_UPDATE: { label: 'Conversation Updated', icon: FilePenLine }, // Catch-all for metadata
	BRANCH: { label: 'Conversation Branched', icon: Split },
	CANCEL: { label: 'Prompt Cancelled', icon: Ban },
	REFUND: { label: 'Prompt Refunded', icon: RotateCcw },
	PLAN_UPDATE: { label: 'Spending Limit Updated', icon: ShieldCheck },
	PLAN_REVOKE: { label: 'Spending Limit Revoked', icon: ShieldOff },
} as const;

export default function useRecentActivity(limit = 10) {
	const { ownerAddress } = useSession();

	return useQuery({
		queryKey: ['recentActivity', ownerAddress],
		queryFn: async () => {
			if (!ownerAddress) return [];

			const variables: GetRecentActivityQueryVariables = {
				owner: ownerAddress.toLowerCase(),
				limit,
			};
			const data = await graphQLClient.request<GetRecentActivityQuery>(
				GET_RECENT_ACTIVITY_QUERY,
				variables,
			);

			return (data.activities || []).map(activity => {
				// If type is not found, fallback to Activity icon
				const details = activityTypeMap[activity.type as keyof typeof activityTypeMap] || {
					label: 'Unknown Action',
					icon: Activity,
				};
				return {
					...activity,
					...details,
					// Format amount from wei to human-readable string
					formattedAmount: formatEther(BigInt(activity.amount)),
					// Format timestamp to "X hours ago"
					formattedTimestamp: formatDistanceToNow(new Date(Number(activity.timestamp) * 1000), {
						addSuffix: true,
					}),
				};
			});
		},
		enabled: !!ownerAddress,
		refetchInterval: 60 * 1000, // Refetch every minute
	});
}
