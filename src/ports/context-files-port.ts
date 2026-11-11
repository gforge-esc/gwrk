/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface ContextFilesPort {
  read(file: string): Promise<string | null>;
  write(file: string, content: string): Promise<void>;
  list(directory: string): Promise<string[]>;
  bundled(file: string): Promise<string>;
  hash(content: string): string;
  today(): string;
}
