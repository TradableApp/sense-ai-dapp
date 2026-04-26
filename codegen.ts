import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: [
		{ 'src/lib/graph/schema.graphql': {} },
		{ 'scalar BigInt\nscalar Bytes': {} },
	],
	generates: {
		'src/lib/graph/generated.ts': {
			plugins: ['typescript'],
			config: {
				scalars: {
					BigInt: 'string',
					Bytes: 'string',
					ID: 'string',
				},
			},
		},
	},
};

export default config;
