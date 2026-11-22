import { dateStr, eraClass, money, pop, scale3, yearStr } from '../src/lib/format'
import { makeContext, provinceColor } from '../src/lib/mapcolors'

describe('formatting', () => {
  it('formats money across magnitudes', () => {
    expect(money(0.5)).toBe('$500 M')
    expect(money(568.3)).toBe('$568.3 B')
    expect(money(1506)).toBe('$1.51 T')
    expect(money(8.85e6)).toBe('$8.85 Qd')
  })
  it('formats population and dates', () => {
    expect(pop(73)).toBe('73.0 M')
    expect(pop(8200)).toBe('8.20 B')
    expect(pop(0.002)).toBe('2.0 K')
    expect(yearStr(-500)).toBe('500 BCE')
    expect(dateStr(1936, 3)).toBe('Mar 1936')
  })
  it('chooses era themes', () => {
    expect(eraClass(1936)).toBe('era-classic')
    expect(eraClass(2026)).toBe('era-modern')
    expect(eraClass(2120, 'Fusion Age')).toBe('era-future')
    expect(eraClass(2400, 'Post-Biological Age')).toBe('era-post')
  })
  it('interpolates colour scales', () => {
    expect(scale3(0, ['#000000', '#ffffff'])).toBe('rgb(0,0,0)')
    expect(scale3(1, ['#000000', '#ffffff'])).toBe('rgb(255,255,255)')
  })
})

describe('map colouring', () => {
  const view: any = {
    meta: { player: 'GER' },
    countries: { GER: { color: '#555555', ideology_id: 'fascism' }, ITA: { color: '#00aa00', ideology_id: 'fascism' }, FRA: { color: '#0000ff', ideology_id: 'liberal_democracy' } },
    treaties: [{ type: 'alliance', members: ['GER', 'ITA'] }], orgs: [], wars: [{ att: ['GER'], def: ['FRA'] }],
    ideologies: { fascism: { family: 'authoritarian' }, liberal_democracy: { family: 'democratic' } },
    provinces: { a: ['GER', 'GER', 10, 1, 9000, 100, 'earth', 1, 0], b: ['ITA', 'ITA', 80, 1, 5000, 40, 'earth', 0, 0], c: ['FRA', 'GER', 30, 1, 7000, 90, 'earth', 1, 0] },
    relations: { ITA: [50, 60], FRA: [-60, 10] },
  }
  const ctx = makeContext(view)
  it('classifies allies and enemies', () => {
    expect(ctx.allies.has('ITA')).toBe(true)
    expect(ctx.enemies.has('FRA')).toBe(true)
    expect(provinceColor('diplomatic', view.provinces.a, ctx)).toBe('#3b82f6')
    expect(provinceColor('diplomatic', view.provinces.b, ctx)).toBe('#22c55e')
    expect(provinceColor('diplomatic', view.provinces.c, ctx)).toBe('#ef4444')
  })
  it('uses owner colours in political mode and family colours in ideology mode', () => {
    expect(provinceColor('political', view.provinces.b, ctx)).toBe('#00aa00')
    expect(provinceColor('ideology', view.provinces.c, ctx)).toBe('#4f8fe0')
  })
  it('grades unrest', () => {
    expect(provinceColor('unrest', view.provinces.b, ctx)).not.toBe(provinceColor('unrest', view.provinces.a, ctx))
  })
})
