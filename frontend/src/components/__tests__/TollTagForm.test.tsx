import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../__tests__/test-utils'
import type { TollTag } from '../../types/toll'

const createMutateAsync = vi.fn().mockResolvedValue({})
const updateMutateAsync = vi.fn().mockResolvedValue({})
vi.mock('../../hooks/queries/useTollRecords', () => ({
  useCreateTollTag: () => ({ mutateAsync: createMutateAsync }),
  useUpdateTollTag: () => ({ mutateAsync: updateMutateAsync }),
}))

import TollTagForm from '../TollTagForm'

beforeEach(() => vi.clearAllMocks())

// M1: fill via the LABEL→control association (getByLabelText) with async userEvent — realistic
// typing/selection, never fireEvent.change and never document.getElementById, so a dropped Field
// htmlFor/id link fails the test. The i18n mock echoes keys, so Field renders these exact
// accessible names (label + ' *' on the two required fields), identical pre- and post-restyle.
describe('TollTagForm — routing + exact payload (SDQ-C)', () => {
  it('create submits the COMPLETE payload INCLUDING vin, and NEVER calls update (fails if a field is dropped, vin is omitted, or it misroutes)', async () => {
    const user = userEvent.setup()
    render(<TollTagForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('toll.tollSystem *'), 'E-ZPass')
    await user.clear(screen.getByLabelText('toll.tagNumber *'))
    await user.type(screen.getByLabelText('toll.tagNumber *'), '0012345678')
    await user.clear(screen.getByLabelText('common:notes'))
    await user.type(screen.getByLabelText('common:notes'), 'primary tag')
    await user.click(screen.getByRole('button', { name: 'toll.addTag' }))
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    // status left untouched ⇒ its FIRST <option> value is 'active' (this select has NO empty option, unlike
    // TollTransactionForm's toll_tag_id — see B2), so the submitted value is 'active'.
    // toStrictEqual + toHaveProperty (mirrors B3) so a dropped field / omitted create-vin fails.
    const payload = createMutateAsync.mock.calls[0][0]
    expect(payload).toStrictEqual({
      toll_system: 'E-ZPass',
      tag_number: '0012345678',
      status: 'active',
      notes: 'primary tag',
      vin: 'V1',
    })
    expect(payload).toHaveProperty('vin')
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('edit submits the UPDATE payload — routing id + edited field, NO vin — and NEVER calls create (fails if it misroutes, drops the id, or leaks a vin into the update)', async () => {
    const tag = {
      id: 4, toll_system: 'SunPass', tag_number: 'ABC', status: 'inactive', notes: '',
    } as unknown as TollTag
    const user = userEvent.setup()
    render(<TollTagForm vin="V1" tag={tag} onClose={vi.fn()} onSuccess={vi.fn()} />)
    await user.clear(screen.getByLabelText('toll.tagNumber *'))
    await user.type(screen.getByLabelText('toll.tagNumber *'), 'XYZ')
    await user.click(screen.getByRole('button', { name: 'toll.updateTag' }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    // COMPLETE 5-property update object (id + all 4 body fields, NO vin) — the toll_system and
    // status selects are untouched, so they keep the seeded defaults ('SunPass' / 'inactive').
    // toStrictEqual + toHaveProperty (mirrors B3) so a dropped field or a leaked vin fails.
    const payload = updateMutateAsync.mock.calls[0][0]
    expect(payload).toStrictEqual({
      id: 4,
      toll_system: 'SunPass',
      tag_number: 'XYZ',
      status: 'inactive',
      notes: '',
    })
    expect(payload).toHaveProperty('id')
    expect(createMutateAsync).not.toHaveBeenCalled()
  })

  it('the Field labels resolve to the controls carrying the expected ids (fails if a Field htmlFor/id association is dropped)', () => {
    render(<TollTagForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByLabelText('toll.tollSystem *')).toHaveAttribute('id', 'toll_system')
    expect(screen.getByLabelText('toll.tagNumber *')).toHaveAttribute('id', 'tag_number')
  })
})

describe('TollTagForm: a stored system outside the list', () => {
  it('stays selected and re-saves unchanged', async () => {
    const tag = { id: 4, vin: 'V1', toll_system: 'PikePass', tag_number: 'PP123', status: 'active', notes: '' } as unknown as TollTag
    const user = userEvent.setup()
    render(<TollTagForm vin="V1" tag={tag} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect((document.getElementById('toll_system') as HTMLSelectElement).value).toBe('PikePass')
    await user.click(screen.getByRole('button', { name: 'toll.updateTag' }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    expect(updateMutateAsync.mock.calls[0][0]).toMatchObject({ toll_system: 'PikePass' })
  })
})
