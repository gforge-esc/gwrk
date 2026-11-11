/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type JudgeVerdict,
  type PromotionDecision,
  type PromotionEvidence,
  evaluatePromotion,
} from "../../domain/model-qualification.js";
import type { StructuredJudgeVerdict } from "../../ports/model-qualification-port.js";

export function evaluateModelPromotion(
  evidence: Omit<PromotionEvidence, "judges"> & {
    readonly judges: readonly StructuredJudgeVerdict[];
  },
): PromotionDecision {
  const judges = evidence.judges.map(
    ({
      judgeBackend,
      judgeProvider,
      judgeFamily,
      judgeModelId,
      ...verdict
    }): JudgeVerdict => ({
      ...verdict,
      judge: {
        backend: judgeBackend,
        provider: judgeProvider,
        family: judgeFamily,
        modelId: judgeModelId,
      },
    }),
  );
  return evaluatePromotion({ ...evidence, judges });
}
