import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: [{ 'src/lib/graph/schema.graphql': {} }, { 'scalar BigInt\nscalar Bytes': {} }],
	documents: 'src/**/*.graphql',
	generates: {
		'src/lib/graph/generated.ts': {
			plugins: ['typescript', 'typescript-operations', 'typescript-react-query'],
			config: {
				scalars: {
					BigInt: 'string',
					Bytes: 'string',
					ID: 'string',
				},
				fetcher: 'fetch',
			},
		},
	},
};

export default config;
