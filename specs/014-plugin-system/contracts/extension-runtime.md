# Contract: Extension Runtime

## `src/plugins/context-provider.ts`

```typescript
export interface ContextResult {
  source: string;
  content: string;
  relevance: number; // 0-1
}

export interface ContextProvider {
  resolveContext(params: {
    keywords: string[];
    projectRoot: string;
    config: Record<string, any>;
  }): Promise<ContextResult[]>;
}
```

## `src/plugins/extension-runtime.ts`

```typescript
export interface ExtensionRuntime {
  resolveExtensionContext(params: {
    keywords: string[];
    projectRoot: string;
    config: Record<string, any>;
  }): Promise<ContextResult[]>;
}
```
