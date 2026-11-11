/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface ToolchainPort {
  readonly language: string;
  readonly sourceExtension: string;
  readonly testExtension: string;
  isSourceFile(filePath: string): boolean;
  isTestFile(filePath: string): boolean;
  colocatedTestCandidates(srcPath: string): string[];
  getBuildCommand(cwd: string): string | null;
  getTestCommand(files?: string[], grepPattern?: string): string | null;
}
