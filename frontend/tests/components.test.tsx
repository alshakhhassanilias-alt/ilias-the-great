import { render, screen, waitFor } from '@testing-library/react'
import { Flag, Markdown, Stat } from '../src/components/common'
import MainMenu from '../src/components/MainMenu'

describe('common components', () => {
  it('renders a deterministic flag', () => {
    const { container } = render(<Flag tag="GER" color="#555555" />)
    expect(container.querySelector('svg rect')?.getAttribute('fill')).toBe('#555555')
  })
  it('renders markdown headings and paragraphs', () => {
    render(<Markdown text={'## Chapter One\n\nThe empire rose.'} />)
    expect(screen.getByText('Chapter One').tagName).toBe('H2')
    expect(screen.getByText('The empire rose.')).toBeInTheDocument()
  })
  it('renders stats with tone', () => {
    render(<Stat label="Stability" value="12%" tone="bad" />)
    expect(screen.getByText('12%').className).toContain('text-red-400')
  })
})

describe('main menu', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url)
      const body = u.includes('/api/scenarios') ? [{ id: '1936', name: 'The Gathering Storm', year: 1936, month: 3, kind: 'historical', desc: 'March 1936' }]
        : u.includes('/api/campaigns') ? [{ id: 'abc', name: 'My Reich', year: 1950, updated: 0, info: { country: 'Germany', era: 'Atomic Age' } }]
          : { ok: true, ai: 'offline' }
      return { ok: true, json: async () => body } as any
    }) as any
  })
  it('lists scenarios and saved campaigns', async () => {
    render(<MainMenu onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText('The Gathering Storm')).toBeInTheDocument())
    expect(screen.getByText('My Reich')).toBeInTheDocument()
    expect(screen.getByText(/AI: offline/)).toBeInTheDocument()
  })
})
