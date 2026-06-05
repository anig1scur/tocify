declare module 'node:dns/promises' {
	export function lookup(
		hostname: string,
		options: { all: true; verbatim?: boolean }
	): Promise<Array<{ address: string; family: number }>>;
}
