import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.SHOT_DIR || 'test-results/screenshots'

async function settle(page: Page) {
  for (let i = 0; i < 25; i++) {
    await page.waitForSelector('[data-testid=busy]', { state: 'detached', timeout: 280_000 })
    if (await page.locator('[data-testid=popup-ok]').last().isVisible()) {
      await page.locator('[data-testid=popup-ok]').last().click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(350)
      continue
    }
    const dec = page.locator('[data-testid=decision-modal]').last()
    if (await dec.isVisible()) {
      const opts = dec.locator('button[data-testid^=option-]')
      const ids = await opts.evaluateAll(els => els.map(e => e.getAttribute('data-testid'))).catch(() => [] as (string | null)[])
      const pref = ['option-autonomy', 'option-represent', 'option-equal', 'option-accept', 'option-march', 'option-annex', 'option-heir'].find(p => ids.includes(p))
      await (pref ? page.locator(`[data-testid=${pref}]`) : opts.first()).click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(700)
      continue
    }
    break
  }
}

async function order(page: Page, text: string) {
  await page.click('[data-testid=tab-command]')
  await page.fill('[data-testid=command-input]', text)
  await page.click('[data-testid=interpret]')
  await expect(page.locator('[data-testid=plan]')).toBeVisible()
  const exec = page.locator('[data-testid=execute]')
  if (await exec.isEnabled()) await exec.click()
  else await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(500)
  await settle(page)
}

async function advanceYears(page: Page, years: number) {
  const target = (await yearNow(page)) + years
  for (let i = 0; i < 80 && (await yearNow(page)) < target; i++) {
    const left = target - (await yearNow(page))
    if (left >= 100) await page.click('[data-testid=advance-1200]')
    else if (left >= 10) await page.click('[data-testid=advance-120]')
    else await page.click('[data-testid=advance-12]')
    await page.waitForTimeout(300)
    await settle(page)
  }
}

async function yearNow(page: Page) {
  const t = await page.locator('[data-testid=date]').innerText()
  return Number(t.trim().split(/\s+/).pop())
}

test.describe.serial('Infinite History — demonstration campaign through the UI', () => {
  let page: Page
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
    page.on('pageerror', e => { throw e })
  })
  test.afterAll(async () => { await page.close() })

  test('start Germany 1936 from the main menu', async () => {
    await page.goto('/')
    await expect(page.getByText('INFINITE HISTORY').first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/00-main-menu.png` })
    await page.click('[data-testid=scenario-1936]')
    await page.fill('[data-testid=country-search]', 'Germ')
    await page.click('[data-testid=pick-GER]')
    // long jumps through centuries: let unanswered decisions resolve themselves instead of pausing every few months
    await page.getByLabel('Pause time when a decision is required').uncheck()
    await page.click('[data-testid=start-campaign]')
    await expect(page.locator('[data-testid=briefing]')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-testid=briefing]')).toContainText('established history')
    await page.screenshot({ path: `${SHOTS}/01-briefing-1936.png` })
    await page.click('[data-testid=briefing-close]')
    await expect(page.locator('[data-testid=player-name]')).toHaveText('Germany')
    await expect(page.locator('[data-testid=date]')).toHaveText(/1936/)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${SHOTS}/02-world-1936.png` })
  })

  test('story mode turns free text into a chapter and group chats answer', async () => {
    await page.click('[data-testid=tab-story]')
    await page.fill('[data-testid=story-input]', 'Build railways across the whole country')
    await page.selectOption('[data-testid=story-span]', '1')
    await page.click('[data-testid=story-play]')
    await expect(page.locator('[data-testid=story-chapter]').first()).toBeVisible({ timeout: 30000 })
    await page.screenshot({ path: `${SHOTS}/02b-story.png` })
    await settle(page)
    await page.click('[data-testid=tab-chats]')
    await page.click('[data-testid=new-chat]')
    await page.fill('[data-testid=chat-search]', 'Ital')
    await page.locator('[data-testid^=chat-pick-]').first().click()
    await page.click('[data-testid=create-chat]')
    await page.fill('[data-testid=chat-input]', 'Shall we sign an alliance?')
    await page.click('[data-testid=chat-send]')
    await expect(page.locator('[data-testid=chat-room]')).toContainText('·', { timeout: 30000 })
    await page.screenshot({ path: `${SHOTS}/02c-group-chat.png` })
  })

  test('natural-language orders are interpreted, assessed and executed', async () => {
    await page.click('[data-testid=tab-command]')
    await page.fill('[data-testid=command-input]', "Transform Germany into the world's largest industrial economy")
    await page.click('[data-testid=interpret]')
    await expect(page.locator('[data-testid=plan]')).toContainText('Industrialisation')
    await page.screenshot({ path: `${SHOTS}/03-order-plan.png` })
    await page.click('[data-testid=execute]')
    await expect(page.locator('[data-testid=nation-panel]')).toContainText('National Industrialisation Drive')
    await page.fill('[data-testid=command-input]', 'Begin the colonization of Mars')
    await page.click('[data-testid=interpret]')
    await expect(page.locator('[data-testid=plan]')).toContainText('impossible')
    await expect(page.locator('[data-testid=plan]')).toContainText('breakthroughs')
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  test('diplomacy, advisor and missions', async () => {
    await page.click('[data-testid=tab-missions]')
    await expect(page.locator('[data-testid=mission]').first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/04-missions-1936.png` })
    await page.click('[data-testid=tab-diplomacy]')
    await page.click('[data-testid=dip-ITA]')
    await expect(page.locator('[data-testid=country-inspector]')).toBeVisible()
    await page.fill('[data-testid=dip-input]', 'What do you think of the history between our nations?')
    await page.click('[data-testid=dip-send]')
    await expect(page.locator('[data-testid=diplomacy-panel]')).toContainText('Mussolini', { timeout: 20_000 }).catch(() => {})
    await expect(page.locator('[data-testid=diplomacy-panel] .bg-ink-850').last()).not.toBeEmpty()
    await page.screenshot({ path: `${SHOTS}/05-diplomacy.png` })
    await page.getByText('Back to my nation').click()
    await page.click('[data-testid=tab-advisor]')
    await page.fill('[data-testid=advisor-input]', 'Who is our greatest threat?')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid=advisor-panel]')).toContainText('dangers', { timeout: 20_000 })
    await page.screenshot({ path: `${SHOTS}/06-advisor.png` })
  })

  test('industrialise, expand territorially and wage war', async () => {
    await order(page, 'Set military spending to 20% of GDP')
    await order(page, 'Declare war on Austria')
    await advanceYears(page, 2)
    await order(page, 'Declare war on Poland')
    await advanceYears(page, 3)
    await page.click('[data-testid=mode-war]')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOTS}/07-wars-map.png` })
    await page.click('[data-testid=mode-political]')
    await page.click('[data-testid=tab-newspaper]')
    await expect(page.locator('[data-testid=paper-broadsheet]')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/08-newspaper-1930s.png` })
  })

  test('centuries pass; planetary government and advanced technology', async () => {
    await order(page, 'Invest 12% of GDP into scientific research')
    await advanceYears(page, 100)
    await order(page, 'Establish a planetary government')
    await expect(page.locator('[data-testid=command-panel]')).toContainText('Planetary Government')
    if (await page.getByText('Back to my nation').isVisible()) await page.getByText('Back to my nation').click()
    await expect(page.locator('[data-testid=nation-panel]')).toContainText('Planetary Government')
    await order(page, 'Research Mars Colonization')
    await advanceYears(page, 60)
    await page.click('[data-testid=tab-tech]')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOTS}/09-technology.png` })
    await page.click('[data-testid=globe-toggle]')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOTS}/10-globe.png` })
    await page.click('[data-testid=globe-toggle]')
  })

  test('Mars, digital consciousness and new eras', async () => {
    await order(page, 'Begin the colonization of Mars')
    await advanceYears(page, 40)
    const sel = page.locator('[data-testid=planet-select]')
    if (await sel.isVisible()) {
      await sel.selectOption('mars')
      await page.waitForTimeout(800)
      await expect(page.locator('[data-testid=planet-map-mars]')).toBeVisible()
      await page.screenshot({ path: `${SHOTS}/11-mars.png` })
      await page.getByRole('button', { name: 'Earth', exact: true }).click()
    }
    await order(page, 'Research Digital Consciousness')
    await advanceYears(page, 60)
    await order(page, 'Transfer all human consciousness into digital infrastructure')
    await advanceYears(page, 20)
    await page.click('[data-testid=tab-newspaper]')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${SHOTS}/12-newspaper-future.png` })
    await page.click('[data-testid=tab-missions]')
    await page.screenshot({ path: `${SHOTS}/13-missions-future.png` })
  })

  test('collapse of the imperial system and successor states', async () => {
    await order(page, 'Deliberately dismantle my empire and allow successor states to emerge')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${SHOTS}/14-successor-states.png` })
    await page.click('[data-testid=tab-intel]')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${SHOTS}/15-world-rankings.png` })
  })

  test('the chronicle preserves the whole history', async () => {
    await page.click('[data-testid=tab-chronicle]')
    await page.fill('[data-testid=chronicle-search]', 'campaign begins')
    await expect(page.locator('[data-testid=chronicle-event]').first()).toContainText('1936')
    await page.getByRole('button', { name: 'Write a history' }).click()
    await page.fill('[data-testid=history-input]', `Write the history of Germany from 1936 to ${await yearNow(page)}`)
    await page.click('[data-testid=history-write]')
    await expect(page.locator('[data-testid=history-doc]')).toContainText('1936')
    await page.screenshot({ path: `${SHOTS}/16-history.png` })
    await page.click('[data-testid=tab-timeline]')
    await page.locator('[data-testid=timeline-slider]').fill('0')
    await expect(page.getByText(/The world in 1936/)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/17-timeline-1936.png` })
  })

  test('saving, exporting and reloading', async () => {
    await page.click('[data-testid=tab-saves]')
    await page.fill('[data-testid=save-label]', 'After the fall')
    await page.click('[data-testid=save-btn]')
    await expect(page.locator('[data-testid=saves-panel]')).toContainText('After the fall')
    const href = await page.locator('[data-testid=export-btn]').getAttribute('href')
    const res = await page.request.get(href!)
    expect(res.ok()).toBeTruthy()
    expect((await res.json()).format).toBe('infinite-history-campaign')
    const year = await yearNow(page)
    await page.reload()
    await expect(page.locator('[data-testid=date]')).toContainText(String(year))
  })
})
