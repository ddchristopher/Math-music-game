import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for the parts that only exist once the whole app is wired up:
 * the start gesture, the play loop, answer handling and the results screen.
 * Audio output itself cannot be asserted here — that stays a manual check.
 */

/** Reads the problem text and works out what the answer should be. */
async function solveCurrentProblem(page: import('@playwright/test').Page): Promise<number> {
  const text = (await page.locator('#problem').textContent())?.trim() ?? '';
  const match = text.match(/^(\d+)\s*([+\-×÷])\s*(\d+)$/);
  expect(match, `unparseable problem: "${text}"`).not.toBeNull();
  const a = Number(match![1]);
  const b = Number(match![3]);
  switch (match![2]) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '×':
      return a * b;
    default:
      return a / b;
  }
}

test('start screen renders and starts a run', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('.logo')).toHaveText('PULSE');
  await expect(page.locator('#play-screen')).toBeHidden();

  await page.locator('#start-button').click();

  await expect(page.locator('#play-screen')).toBeVisible();
  await expect(page.locator('#start-screen')).toBeHidden();
  await expect(page.locator('#problem')).not.toBeEmpty();
  await expect(page.locator('#scratchpad')).toBeVisible();
});

test('a correct answer scores points and advances to a new problem', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start-button').click();
  await expect(page.locator('#problem')).not.toBeEmpty();

  const first = await page.locator('#problem').textContent();
  const answer = await solveCurrentProblem(page);

  await page.keyboard.type(String(answer));

  // Auto-submit fires on the last digit, so both the score and the problem move.
  await expect
    .poll(async () => Number(await page.locator('#score').textContent()))
    .toBeGreaterThan(0);
  await expect(page.locator('#streak')).toHaveText('1');
  await expect(page.locator('#problem')).not.toHaveText(first ?? '');
});

test('a wrong answer resets the streak and reveals the answer', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start-button').click();
  await expect(page.locator('#problem')).not.toBeEmpty();

  const answer = await solveCurrentProblem(page);
  // A digit string of the right length that is definitely not the answer.
  const wrong = String(answer + 1).slice(0, String(answer).length).padStart(
    String(answer).length,
    '9',
  );

  await page.keyboard.type(wrong === String(answer) ? '0'.repeat(String(answer).length) : wrong);

  await expect(page.locator('#streak')).toHaveText('0');
  await expect(page.locator('#score')).toHaveText('0');
});

test('the on-screen keypad drives the same input path', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start-button').click();
  await expect(page.locator('#problem')).not.toBeEmpty();

  const answer = await solveCurrentProblem(page);
  for (const digit of String(answer)) {
    await page.locator(`.key[data-key="${digit}"]`).click();
  }

  await expect
    .poll(async () => Number(await page.locator('#score').textContent()))
    .toBeGreaterThan(0);
});

test('drawing on the scratchpad does not disturb the run', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start-button').click();
  await expect(page.locator('#problem')).not.toBeEmpty();

  const box = await page.locator('#scratchpad').boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + 60, box!.y + box!.height * 0.6);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(box!.x + 60 + i * 14, box!.y + box!.height * 0.6 + Math.sin(i) * 18);
  }
  await page.mouse.up();

  // The problem is still live and still answerable after drawing over it.
  const answer = await solveCurrentProblem(page);
  await page.keyboard.type(String(answer));
  await expect(page.locator('#streak')).toHaveText('1');
});

test('settings persist across a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#open-settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();

  await page.locator('#set-require-enter').check();
  await page.locator('#close-settings').click();

  await page.reload();
  await page.locator('#open-settings').click();
  await expect(page.locator('#set-require-enter')).toBeChecked();
});

test('require-Enter mode waits for Enter before grading', async ({ page }) => {
  await page.goto('/');
  await page.locator('#open-settings').click();
  await page.locator('#set-require-enter').check();
  await page.locator('#close-settings').click();

  await page.locator('#start-button').click();
  await expect(page.locator('#problem')).not.toBeEmpty();

  const answer = await solveCurrentProblem(page);
  await page.keyboard.type(String(answer));

  // Nothing graded yet — the entry is just sitting there.
  await expect(page.locator('#entry')).toHaveText(String(answer));
  await expect(page.locator('#score')).toHaveText('0');

  await page.keyboard.press('Enter');
  await expect
    .poll(async () => Number(await page.locator('#score').textContent()))
    .toBeGreaterThan(0);
});

test('the run ends and shows results', async ({ page }) => {
  await page.goto('/');
  await page.locator('#start-button').click();
  await expect(page.locator('#problem')).not.toBeEmpty();

  // Jump the clock to the end of the run rather than waiting 90 real seconds.
  await page.evaluate(() => {
    const original = performance.now.bind(performance);
    const offset = 95_000;
    performance.now = () => original() + offset;
  });

  await expect(page.locator('#results-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#result-score')).not.toBeEmpty();
  await expect(page.locator('#result-stats .stat').first()).toBeVisible();
});
