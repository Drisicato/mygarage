import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { render } from '../../__tests__/test-utils'
import type { Recall } from '../../types/recall'

const createMutateAsync = vi.fn().mockResolvedValue({})
const updateMutateAsync = vi.fn().mockResolvedValue({})
vi.mock('../../hooks/queries/useRecallRecords', () => ({
  useCreateRecallRecord: () => ({ mutateAsync: createMutateAsync }),
  useUpdateRecallRecord: () => ({ mutateAsync: updateMutateAsync }),
}))

import RecallForm from '../RecallForm'

beforeEach(() => vi.clearAllMocks())

describe('RecallForm — routing + checkbox wiring + exact payload', () => {
  it('create submits the COMPLETE payload (all fields + stamped vin, is_resolved:false) to createRecallRecord and NEVER calls update (fails if any field is dropped, vin is missing, or it misroutes)', async () => {
    render(<RecallForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(document.getElementById('component')!, { target: { value: 'Brakes' } })
    fireEvent.change(document.getElementById('summary')!, { target: { value: 'Brake line corrosion' } })
    // B2: a VALID date_announced — the schema (makeDateSchema) rejects '' even under
    // .optional(), so an empty value makes safeParse fail and the mutation never fires.
    fireEvent.change(document.getElementById('date_announced')!, { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'recall.addRecall' }))
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    expect(createMutateAsync).toHaveBeenCalledWith({
      nhtsa_campaign_number: '',
      component: 'Brakes',
      summary: 'Brake line corrosion',
      consequence: '',
      remedy: '',
      date_announced: '2026-02-01',
      is_resolved: false,
      notes: '',
      vin: 'V1',
    })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('checking "mark resolved" before create sends the COMPLETE payload with is_resolved:true (fails if the Checkbox is unwired to register, or the true branch is dropped)', async () => {
    render(<RecallForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(document.getElementById('component')!, { target: { value: 'Brakes' } })
    fireEvent.change(document.getElementById('summary')!, { target: { value: 'x' } })
    fireEvent.change(document.getElementById('date_announced')!, { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByLabelText('recall.markAsResolved'))
    fireEvent.click(screen.getByRole('button', { name: 'recall.addRecall' }))
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    expect(createMutateAsync).toHaveBeenCalledWith({
      nhtsa_campaign_number: '',
      component: 'Brakes',
      summary: 'x',
      consequence: '',
      remedy: '',
      date_announced: '2026-02-01',
      is_resolved: true,
      notes: '',
      vin: 'V1',
    })
    expect(updateMutateAsync).not.toHaveBeenCalled()
  })

  it('edit submits the COMPLETE update payload — routing id + the edited field, NO vin stamp — and NEVER calls create (fails if any field is dropped or it misroutes)', async () => {
    // B2: the edit fixture supplies a VALID date_announced, never ''.
    const recall = { id: 42, vin: 'V1', nhtsa_campaign_number: '', component: 'Airbag', summary: 'x', consequence: '', remedy: '', date_announced: '2026-02-01', is_resolved: false, notes: '' } as unknown as Recall
    render(<RecallForm vin="V1" recall={recall} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(document.getElementById('component')!, { target: { value: 'Airbag Inflator' } }) // change a field to observe it lands
    fireEvent.click(screen.getByRole('button', { name: 'recall.updateRecall' }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 42,
      nhtsa_campaign_number: '',
      component: 'Airbag Inflator',
      summary: 'x',
      consequence: '',
      remedy: '',
      date_announced: '2026-02-01',
      is_resolved: false,
      notes: '',
    })
    expect(createMutateAsync).not.toHaveBeenCalled()
  })
})

describe('RecallForm: the announce date is optional and can be cleared', () => {
  it('creates a recall without one', async () => {
    render(<RecallForm vin="V1" onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(document.getElementById('component')!, { target: { value: 'Brakes' } })
    fireEvent.change(document.getElementById('summary')!, { target: { value: 'Brake line corrosion' } })
    fireEvent.click(screen.getByRole('button', { name: 'recall.addRecall' }))
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    expect(createMutateAsync.mock.calls[0][0].date_announced).toBeUndefined()
  })

  it('clearing it on edit posts null', async () => {
    const recall = { id: 42, vin: 'V1', nhtsa_campaign_number: '', component: 'Airbag', summary: 'x', consequence: '', remedy: '', date_announced: '2026-02-01', is_resolved: false, notes: '' } as unknown as Recall
    render(<RecallForm vin="V1" recall={recall} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(document.getElementById('date_announced')!, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'recall.updateRecall' }))
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    expect(updateMutateAsync.mock.calls[0][0].date_announced).toBeNull()
  })
})
