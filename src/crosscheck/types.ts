/**
 * Inputs for the pure crosscheck comparison (SPEC 1.8).
 *
 * Everything the comparison needs arrives already gathered: declaring the
 * inputs rather than reading them is what keeps this module pure (SPEC 6.1).
 */

import type {
  DeclaredIndex,
  IndexReference,
  UncoveredMechanism,
} from "../matrix/types.ts";

export interface CrosscheckInput {
  ref: string;
  /** Injected, never read from the clock. */
  generatedAt: string;
  tool: string;
  declared: DeclaredIndex[];
  references: IndexReference[];
  uncovered: UncoveredMechanism[];
  /**
   * WCS modules with the index each one declares, read from its own
   * `fields/template-settings.json`. Never inferred from the module path.
   */
  wcsModules: { name: string; indexPatterns: string[] }[];
  /** Which repositories the scan actually reached. */
  scannedRepos: string[];
}
