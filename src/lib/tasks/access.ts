import type { AccessRoleId } from '@/lib/access/types'

import type { AppUser, AccessStore } from '@/lib/access/types'

import type { WorkTask, TaskAccessLevel } from './types'
import { taskHasAssignee } from './assignees'



/** По умолчанию: все выполняют (my); раздаёт дирекция; sysadmin — полный доступ. */

export const DEFAULT_ROLE_TASK_ACCESS: Record<AccessRoleId, TaskAccessLevel> = {

  sysadmin: 'manage',

  operations_director: 'board',

  chief_engineer: 'my',

  workshop_master: 'my',

  technologist: 'my',

  otc: 'my',

  mixer: 'my',

  warehouse_keeper: 'my',

  procurement_manager: 'my',

  hr: 'my',

  hr_inspector: 'my',

  finance: 'my',

  office_manager: 'my',

  it_specialist: 'my',

  sales_dispatcher: 'my',

  employee: 'my',

  cook: 'my',

  timeclock: 'none',

  secretary: 'my',

}



/** Доски для раздачи — только у кого по умолчанию есть право назначать. */

export const DEFAULT_ROLE_TASK_BOARDS: Partial<Record<AccessRoleId, string[]>> = {

  sysadmin: [

    'board_office',

    'board_general',

    'board_production',

    'board_warehouse',

    'board_quality',

    'board_it',

    'board_management',

  ],

  operations_director: ['board_management', 'board_production', 'board_general'],

}



export function resolveRoleTaskAccessLevel(

  access: AccessStore | undefined,

  roleId: AccessRoleId,

): TaskAccessLevel {

  if (roleId === 'sysadmin') return 'manage'

  const roleLevel = access?.roleTaskAccess?.[roleId]

  if (roleLevel) return roleLevel

  return DEFAULT_ROLE_TASK_ACCESS[roleId] ?? 'my'

}



export function resolveTaskAccessLevel(

  user: AppUser | null | undefined,

  access: AccessStore | undefined,

): TaskAccessLevel {

  if (!user) return 'none'

  if (user.roleId === 'sysadmin') return 'manage'

  if (user.taskAccessLevel) return user.taskAccessLevel

  return resolveRoleTaskAccessLevel(access, user.roleId)

}



export function resolveTaskBoardIds(

  user: AppUser | null | undefined,

  access: AccessStore | undefined,

): string[] {

  if (!user) return []

  if (user.taskBoards?.length) return [...user.taskBoards]

  const roleBoards = access?.roleTaskBoards?.[user.roleId]

  if (roleBoards?.length) return [...roleBoards]

  const level = resolveTaskAccessLevel(user, access)

  if (level === 'board' || level === 'manage') {

    return [...(DEFAULT_ROLE_TASK_BOARDS[user.roleId] ?? ['board_general'])]

  }

  return []

}



export function canUseTasksSection(level: TaskAccessLevel): boolean {

  return level !== 'none'

}



export function canAssignTasks(

  user: AppUser | null | undefined,

  access: AccessStore | undefined,

): boolean {

  const level = resolveTaskAccessLevel(user, access)

  return level === 'board' || level === 'manage'

}



export function canViewTaskBoards(level: TaskAccessLevel): boolean {

  return level === 'board' || level === 'manage'

}



export function canManageTaskBoard(level: TaskAccessLevel): boolean {

  return level === 'manage'

}



export function canAccessTaskBoard(

  boardId: string,

  user: AppUser | null | undefined,

  access: AccessStore | undefined,

): boolean {

  const level = resolveTaskAccessLevel(user, access)

  if (!canViewTaskBoards(level)) return false

  if (user?.roleId === 'sysadmin') return true

  const allowed = resolveTaskBoardIds(user, access)

  return allowed.includes(boardId)

}



export function canEditWorkTask(
  task: Pick<WorkTask, 'createdBy' | 'assigneeUserId' | 'assigneeUserIds'>,
  user: AppUser | null | undefined,
  access: AccessStore | undefined,
  boardId: string,
): boolean {
  if (!user) return false
  const level = resolveTaskAccessLevel(user, access)
  if (level === 'manage' && canAccessTaskBoard(boardId, user, access)) return true
  if (user.id === task.createdBy) return true
  if (taskHasAssignee(task, user.id)) return true
  return false
}



export function canCreateTaskOnBoard(

  boardId: string,

  user: AppUser | null | undefined,

  access: AccessStore | undefined,

): boolean {

  if (!canAssignTasks(user, access)) return false

  return canAccessTaskBoard(boardId, user, access)

}



export function canViewTasksSummary(

  user: AppUser | null | undefined,

  access: AccessStore | undefined,

): boolean {

  if (!canUseTasksSection(resolveTaskAccessLevel(user, access))) return false

  if (user?.roleId === 'sysadmin' || user?.roleId === 'operations_director') return true

  return resolveTaskBoardIds(user, access).includes('board_management')

}


