# E2E Testing Patterns (Playwright)

Reference guide for writing feature-specific Playwright tests. All UI features require E2E coverage per `/implement` workflow.

## Directory Structure

```
e2e/
├── smoke.spec.ts          # Basic health checks (existing)
├── auth.spec.ts           # Login/logout flows
├── {feature-name}.spec.ts # Feature-specific tests (you create this)
└── helpers/
    └── auth.ts            # Shared auth utilities
```

## Auth Helper Pattern

```typescript
// e2e/helpers/auth.ts
import { Page } from '@playwright/test';

export async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'password');
  await page.click('button[type="submit"]');
  await page.waitForURL(/.*dashboard|.*home/);
}

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/.*dashboard|.*home/);
}
```

## Feature Test Template

```typescript
import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('{Feature Name}', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/{feature-url}');
  });

  test('golden path: user can {primary action}', async ({ page }) => {
    // 1. Setup: Navigate to starting state
    await page.click('button:has-text("New Item")');
    
    // 2. Action: Execute the main user flow
    await page.fill('input[name="title"]', 'Test Item');
    await page.click('button:has-text("Save")');
    
    // 3. Assert: Verify success state
    await expect(page.getByText('Item saved')).toBeVisible();
    await expect(page.getByText('Test Item')).toBeVisible();
  });

  test('handles validation error', async ({ page }) => {
    await page.click('button:has-text("New Item")');
    await page.click('button:has-text("Save")'); // Submit empty
    
    await expect(page.getByText(/required|cannot be empty/i)).toBeVisible();
  });

  test('handles empty state', async ({ page }) => {
    // Verify empty state UI is correct
    await expect(page.getByText(/no items|get started/i)).toBeVisible();
  });
});
```

## Shadcn Component Selectors

```typescript
// Dialog
await page.click('[role="dialog"] button:has-text("Confirm")');
await expect(page.locator('[role="dialog"]')).not.toBeVisible();

// Select/Dropdown
await page.click('[role="combobox"]');
await page.click('[role="option"]:has-text("Option 1")');

// Toast notification
await expect(page.locator('[data-sonner-toast]')).toContainText('Success');

// Tabs
await page.click('[role="tab"]:has-text("Settings")');
await expect(page.locator('[role="tabpanel"]')).toBeVisible();

// Table row selection
await page.click('table tbody tr:first-child');
await expect(page.locator('table tbody tr:first-child')).toHaveClass(/selected/);
```

## API Verification in E2E

```typescript
test('API returns correct data', async ({ request }) => {
  const response = await request.get('/api/items');
  expect(response.ok()).toBeTruthy();
  
  const data = await response.json();
  expect(data).toHaveProperty('items');
  expect(data.items.length).toBeGreaterThan(0);
});

test('authenticated API call', async ({ page, request }) => {
  // Get auth token from page context
  await loginAsAdmin(page);
  const cookies = await page.context().cookies();
  
  const response = await request.get('/api/protected', {
    headers: {
      Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ')
    }
  });
  expect(response.ok()).toBeTruthy();
});
```

## Visual Assertions

```typescript
// Check styling exists (not raw unstyled HTML)
test('has proper styling', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Submit' });
  
  // Verify Tailwind classes applied (background color exists)
  await expect(button).toHaveCSS('background-color', /.+/);
  
  // Verify not default browser styling
  const bgColor = await button.evaluate(el => 
    getComputedStyle(el).backgroundColor
  );
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)'); // Not transparent
});
```

## Running Tests

```bash
# Run specific feature test
npx playwright test e2e/{feature-name}.spec.ts

# Run with UI (debugging)
npx playwright test --ui

# Run in container context
BASE_URL=http://localhost:3000 npx playwright test

# Generate report
npx playwright show-report
```

## Checklist Before Marking E2E Complete

- [ ] Test file created: `e2e/{feature-name}.spec.ts`
- [ ] Golden Path covered (main user flow from spec)
- [ ] At least 1 error/edge case tested
- [ ] Tests pass locally: `npx playwright test e2e/{feature-name}.spec.ts`
- [ ] Tests pass in Docker: `BASE_URL=http://localhost:3000 npx playwright test`
