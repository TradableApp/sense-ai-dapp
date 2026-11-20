import type useChatMutations from '@/hooks/useChatMutations';

type ChatMutations = ReturnType<typeof useChatMutations>;

export default function useOneSendAtATime(mutations: ChatMutations): ChatMutations {
	return mutations;
}
