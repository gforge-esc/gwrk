# Contracts: Task Management

Contract for managing the local task state in `tasks.json`.

## State Service (`src/utils/state.ts`)

Service responsible for reading, writing, and validating the task state.

### `getTaskState(featureId: string): Promise<TaskState>`
- **Description**: Loads the `tasks.json` file for the given feature.
- **Preconditions**: `specs/${featureId}/.gwrk/tasks.json` exists.
- **Returns**: `TaskState` object.
- **Throws**: `Error` if file is missing or invalid according to Zod schema.

### `saveTaskState(featureId: string, state: TaskState): Promise<void>`
- **Description**: Atomically writes the `TaskState` to `specs/${featureId}/.gwrk/tasks.json`.
- **Preconditions**: `specs/${featureId}/.gwrk/` exists.
- **Returns**: `void`.
- **Throws**: `Error` if file write fails.

### `markTaskComplete(featureId: string, taskId: string): Promise<void>`
- **Description**: Updates a task's status to 'completed'.
- **Preconditions**: Task exists in `tasks.json`.
- **Returns**: `void`.
- **Throws**: `Error` if task not found.

## Execution Service (`src/utils/exec.ts`)

Service responsible for executing shell commands and gates.

### `runGate(featureId: string, taskId: string): Promise<number>`
- **Description**: Executes `specs/${featureId}/gates/${taskId}-gate.sh`.
- **Preconditions**: Gate script exists and is executable.
- **Returns**: `number` (exit code).
- **Throws**: `Error` if script missing.

### `runAgent(workflow: string, featureId: string, options?: any): Promise<void>`
- **Description**: Executes `gemini -p "/${workflow} ${featureId}"`.
- **Preconditions**: `gemini` CLI is on the path.
- **Returns**: `void`.
- **Throws**: `Error` if agent fails.
