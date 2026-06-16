/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { AgentBackendConfig, ModelEntry } from "./agent-registry.js";
import type { QuotaProber } from "./quota-prober.js";
import { TaskClassification, TaskType } from "./task-classifier.js";

export class ModelSelector {
  /**
   * Selects the appropriate model from a backend's available models.
   * Dimension 2 of routing.
   *
   * @param backend The backend configuration
   * @param classification The task classification (thinking, fast, high-context)
   * @param taskType The raw task type (to handle reviewModel override)
   * @param prober The quota prober (to check model cooldowns)
   * @returns The selected model and whether failover was used
   */
  selectModel(
    backend: AgentBackendConfig,
    classification: TaskClassification,
    taskType: string | TaskType,
    prober: QuotaProber,
  ): { model: ModelEntry | null; modelFailoverUsed: boolean } {
    // 1. Handle reviewModel override for review/test tasks
    if (
      backend.reviewModel &&
      (taskType === TaskType.REVIEW || taskType === TaskType.TEST)
    ) {
      // Find the model entry for the review model if it exists, otherwise create a virtual one
      const reviewModelEntry = backend.models.find(
        (m) => m.modelFlag === backend.reviewModel,
      ) || {
        name: "review-model-override",
        tier: TaskClassification.THINKING,
        modelFlag: backend.reviewModel,
      };

      if (!prober.isModelInCooldown(backend.name, reviewModelEntry.name)) {
        return { model: reviewModelEntry, modelFailoverUsed: false };
      }
      // If review model is in cooldown, fall through to normal selection
    }

    // 2. Filter models by preferred tier
    const preferredModels = backend.models.filter(
      (m) => m.tier === classification,
    );

    // 3. Try to find a non-cooldown model in preferred tier
    for (let i = 0; i < preferredModels.length; i++) {
      const model = preferredModels[i];
      if (!prober.isModelInCooldown(backend.name, model.name)) {
        // modelFailoverUsed is true if it's not the first model in the preferred tier
        return { model, modelFailoverUsed: i > 0 };
      }
    }

    // 4. Model Failover: Try ANY non-cooldown model in the provider's array order
    for (const model of backend.models) {
      if (!prober.isModelInCooldown(backend.name, model.name)) {
        return { model, modelFailoverUsed: true };
      }
    }

    // 5. All models in cooldown
    return { model: null, modelFailoverUsed: false };
  }

  /**
   * Renders the final command string by substituting templates.
   */
  renderCommand(template: string, model: ModelEntry): string {
    // Replace all occurrences of {{model}}
    let command = template.replace(
      /\{\{model\}\}/g,
      model.modelFlag || model.name,
    );

    if (model.effort) {
      command += ` --effort ${model.effort}`;
    }

    return command;
  }
}
