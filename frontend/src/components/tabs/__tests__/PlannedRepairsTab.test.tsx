import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { PlannedRepair, RepairStatus } from '../../../types/plannedRepair'

interface BoardProps {
  repairs: PlannedRepair[]
  onEdit: (repair: PlannedRepair) => void
  onDelete: (repair: PlannedRepair) => void
  onMove: (repair: PlannedRepair, status: RepairStatus, position: number) => void
}
interface DialogProps {
  repair: PlannedRepair
  onClose: () => void
}

const boardMock = vi.fn<(props: BoardProps) => void>()
const dialogMock = vi.fn<(props: DialogProps) => void>()
const moveMutate = vi.fn()
const deleteMutate = vi.fn()
const usePlannedRepairsMock = vi.fn()

vi.mock('../../planned-repairs/PlannedRepairBoard', () => ({
  default: (props: BoardProps) => {
    boardMock(props)
    return <div>PlannedRepairBoard</div>
  },
}))
vi.mock('../../planned-repairs/PlannedRepairForm', () => ({
  default: () => <div>PlannedRepairForm</div>,
}))
vi.mock('../../planned-repairs/CompleteRepairDialog', () => ({
  default: (props: DialogProps) => {
    dialogMock(props)
    return <div>CompleteRepairDialog</div>
  },
}))
vi.mock('../../../hooks/queries/usePlannedRepairs', () => ({
  usePlannedRepairs: () => usePlannedRepairsMock(),
  useMovePlannedRepair: () => ({ mutate: moveMutate }),
  useDeletePlannedRepair: () => ({ mutate: deleteMutate }),
}))
vi.mock('../../../hooks/useLatestMileage', () => ({ useLatestMileage: () => ({ data: 1000 }) }))
vi.mock('../../../hooks/useLatestHours', () => ({ useLatestHours: () => ({ data: null }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import PlannedRepairsTab from '../PlannedRepairsTab'

const repair = (overrides: Partial<PlannedRepair> = {}) =>
  ({
    id: 1,
    title: 'Brakes',
    status: 'in_progress',
    service_visit_id: null,
    parts: [],
    ...overrides,
  }) as unknown as PlannedRepair

describe('PlannedRepairsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlannedRepairsMock.mockReturnValue({ data: { repairs: [repair()], total: 1 }, isLoading: false, error: null })
  })

  it('shows the empty state with no repairs', () => {
    usePlannedRepairsMock.mockReturnValue({ data: { repairs: [], total: 0 }, isLoading: false, error: null })
    render(<PlannedRepairsTab vin="V1" />)
    expect(screen.getByText('plannedRepairs.empty')).toBeInTheDocument()
    expect(boardMock).not.toHaveBeenCalled()
  })

  it('moves between stages that are not Done straight through the API', () => {
    render(<PlannedRepairsTab vin="V1" />)
    const { onMove } = boardMock.mock.calls[0][0]
    act(() => onMove(repair(), 'planning', 0))
    expect(moveMutate).toHaveBeenCalledWith({ id: 1, status: 'planning', position: 0 }, expect.any(Object))
    expect(dialogMock).not.toHaveBeenCalled()
  })

  it('opens the completion dialog, not a move, when a repair with no visit reaches Done', () => {
    render(<PlannedRepairsTab vin="V1" />)
    const { onMove } = boardMock.mock.calls[0][0]
    act(() => onMove(repair(), 'done', 0))
    expect(moveMutate).not.toHaveBeenCalled()
    expect(screen.getByText('CompleteRepairDialog')).toBeInTheDocument()
    expect(dialogMock).toHaveBeenCalledWith(expect.objectContaining({ repair: expect.objectContaining({ id: 1 }) }))
  })

  it('moves a repair that already logged its visit back into Done without a second visit', () => {
    render(<PlannedRepairsTab vin="V1" />)
    const { onMove } = boardMock.mock.calls[0][0]
    act(() => onMove(repair({ service_visit_id: 42 }), 'done', 0))
    expect(moveMutate).toHaveBeenCalledWith({ id: 1, status: 'done', position: 0 }, expect.any(Object))
    expect(dialogMock).not.toHaveBeenCalled()
  })
})
