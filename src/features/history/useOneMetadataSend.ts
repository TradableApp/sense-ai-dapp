export interface MetadataMutateOptions {
	onSuccess: () => Promise<void>;
	onError: () => void;
}

export default function useOneMetadataSend<V>(
	mutate: (_variables: V, _options: MetadataMutateOptions) => void,
) {
	return (variables: V, onSaved: () => Promise<void>) =>
		mutate(variables, { onSuccess: onSaved, onError: () => undefined });
}
