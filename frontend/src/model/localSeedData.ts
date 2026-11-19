/**
 * ローカルモック専用シード（VITE_USE_API=false のときのみバンドルに残る）。
 * 公開用は架空ラベルのみ。本番 API ビルドでは DCE で除去される。
 */
import type { MemberMasterRecord } from './membersMaster'

const USE_LOCAL_SEED = import.meta.env.VITE_USE_API === 'false'

export type LocalSection = {
  id: string
  name: string
  mgr: string
  sales: string
}

/** 本番ビルドでは空。ローカルモック時のみ架空サンプル */
export const localMemberMaster: MemberMasterRecord[] = USE_LOCAL_SEED
  ? [
      { id: 1, surname: 'HiddenAdmin', sectionId: 'unset', role: 'other', isInterviewer: false, isDeleted: false },
      { id: 2, surname: 'Engineer02', sectionId: 'meguro', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 3, surname: 'MgrA', sectionId: 'meguro', role: 'mgr', isInterviewer: true, isDeleted: false },
      { id: 4, surname: 'SalesA', sectionId: 'unset', role: 'sales', isInterviewer: true, isDeleted: false },
      { id: 5, surname: 'MgrB', sectionId: 'yamamoto', role: 'mgr', isInterviewer: true, isDeleted: false },
      { id: 6, surname: 'MgrC', sectionId: 'ishibashi', role: 'mgr', isInterviewer: true, isDeleted: false },
      { id: 7, surname: 'Engineer07', sectionId: 'ishibashi', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 8, surname: 'Engineer08', sectionId: 'yamamoto', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 9, surname: 'Engineer09', sectionId: 'meguro', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 10, surname: 'Engineer10', sectionId: 'ishibashi', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 11, surname: 'Engineer11', sectionId: 'ishibashi', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 12, surname: 'Engineer12', sectionId: 'hamada', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 13, surname: 'MgrD', sectionId: 'tanaka', role: 'mgr', isInterviewer: true, isDeleted: false },
      { id: 14, surname: 'Engineer14', sectionId: 'tanaka', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 15, surname: 'Engineer15', sectionId: 'yamamoto', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 16, surname: 'Engineer16', sectionId: 'yamamoto', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 17, surname: 'Engineer17', sectionId: 'tanaka', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 18, surname: 'Engineer18', sectionId: 'ishibashi', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 19, surname: 'MgrE', sectionId: 'hamada', role: 'mgr', isInterviewer: true, isDeleted: false },
      { id: 20, surname: 'Engineer20', sectionId: 'meguro', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 21, surname: 'Engineer21', sectionId: 'tanaka', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 22, surname: 'Engineer22', sectionId: 'hamada', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 23, surname: 'Engineer23', sectionId: 'meguro', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 24, surname: 'Engineer24', sectionId: 'tanaka', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 25, surname: 'Engineer25', sectionId: 'hamada', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 26, surname: 'Engineer26', sectionId: 'yamamoto', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 27, surname: 'SalesB', sectionId: 'unset', role: 'sales', isInterviewer: true, isDeleted: false },
      { id: 28, surname: 'Engineer28', sectionId: 'meguro', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 29, surname: 'Engineer29', sectionId: 'yamamoto', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 30, surname: 'Engineer30', sectionId: 'ishibashi', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 31, surname: 'Engineer31', sectionId: 'tanaka', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 32, surname: 'Engineer32', sectionId: 'hamada', role: 'engineer', isInterviewer: true, isDeleted: false },
      { id: 33, surname: 'Coordinator', sectionId: 'unset', role: 'hongo', isInterviewer: true, isDeleted: false },
    ]
  : []

export const localSectionDisplayNames: Record<string, string> = USE_LOCAL_SEED
  ? {
      meguro: 'Section A',
      yamamoto: 'Section B',
      ishibashi: 'Section C',
      tanaka: 'Section D',
      hamada: 'Section E',
    }
  : {
      meguro: '',
      yamamoto: '',
      ishibashi: '',
      tanaka: '',
      hamada: '',
    }

export const localSections: LocalSection[] = USE_LOCAL_SEED
  ? [
      { id: 'meguro', name: 'Section A', mgr: 'Mgr A', sales: '' },
      { id: 'yamamoto', name: 'Section B', mgr: 'Mgr B', sales: '' },
      { id: 'ishibashi', name: 'Section C', mgr: 'Mgr C', sales: '' },
      { id: 'tanaka', name: 'Section D', mgr: 'Mgr D', sales: '' },
      { id: 'hamada', name: 'Section E', mgr: 'Mgr E', sales: '' },
    ]
  : [
      { id: 'meguro', name: '', mgr: '', sales: '' },
      { id: 'yamamoto', name: '', mgr: '', sales: '' },
      { id: 'ishibashi', name: '', mgr: '', sales: '' },
      { id: 'tanaka', name: '', mgr: '', sales: '' },
      { id: 'hamada', name: '', mgr: '', sales: '' },
    ]

export const localVoterLabels: Record<string, string> = USE_LOCAL_SEED
  ? {
      hongo: 'Coordinator',
      meguro: 'Mgr A',
      yamamoto: 'Mgr B',
      ishibashi: 'Mgr C',
      tanaka: 'Mgr D',
      hamada: 'Mgr E',
    }
  : {
      hongo: '',
      meguro: '',
      yamamoto: '',
      ishibashi: '',
      tanaka: '',
      hamada: '',
    }

export const localSalesFallback: Record<string, string> = USE_LOCAL_SEED
  ? {
      salesA: 'Sales A',
      salesB: 'Sales B',
    }
  : {
      salesA: '営業A',
      salesB: '営業B',
    }
