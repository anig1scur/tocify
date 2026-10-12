import {
  generateBoard,
  processToc,
  processTocWithDiagnostics,
  type DirectApiConfig,
  type GraphNodeInput,
  type TocInputConfig,
} from '$lib/llm/core';

export type { DirectApiConfig, GraphNodeInput, GraphResponse, Provider, TocInputConfig } from '$lib/llm/core';

export async function processTocDirect(config: TocInputConfig) {
  return processToc(config);
}

export async function processTocWithDiagnosticsDirect(config: TocInputConfig) {
  return processTocWithDiagnostics(config);
}

export async function generateBoardDirect(
  tocItems: GraphNodeInput[],
  config: DirectApiConfig,
) {
  return generateBoard(tocItems, config);
}
