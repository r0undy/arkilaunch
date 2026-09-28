import type { Locator } from '@playwright/test';

// The AWS-style dropdown (components/select.tsx) is a combobox over a hidden
// native <select>, so Playwright's selectOption has nothing visible to act
// on. This opens the menu and clicks the option instead. A string picks by
// value, like selectOption('x'); { label } matches the option's text.
export async function choose(
  trigger: Locator,
  pick: string | { label: string } | { value: string } | { index: number },
): Promise<void> {
  await trigger.click();
  const list = trigger.page().getByRole('listbox');
  const option =
    typeof pick === 'string'
      ? list.locator(`[role="option"][data-value="${pick}"]`)
      : 'index' in pick
        ? list.getByRole('option').nth(pick.index)
        : 'value' in pick
          ? list.locator(`[role="option"][data-value="${pick.value}"]`)
          : list.getByRole('option').filter({ hasText: pick.label }).first();
  await option.click();
}
