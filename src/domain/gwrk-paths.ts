/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { join } from "node:path";

export function resolveGwrkPaths(
  env: Readonly<Record<string, string | undefined>>,
  userHome: string,
) {
  const home = env.GWRK_HOME || env.GWRK_DIR || join(userHome, ".gwrk");
  return {
    home,
    runtimeDir: env.GWRK_RUNTIME_DIR || home,
    database: env.GWRK_DB_PATH || join(env.GWRK_DIR || home, "gwrk.db"),
  };
}
