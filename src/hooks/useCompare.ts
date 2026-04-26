import stringify from 'json-stable-stringify';

import usePrevious from './usePrevious';

export default function useCompare(value) {
	const valueAsString = stringify(value);
	const prevValueAsString = usePrevious(valueAsString);

	return prevValueAsString !== valueAsString;
}
